// Pass 2: the soundtrack. Every note the app sent to the stand-in OP-1 is
// rendered here at the moment it was stamped, with a small synthesizer for
// each part; parts "on tape" keep looping underneath, as the OP-1's tape
// would play them back; and the ad gets its sound design: a riser into the
// drop, an impact, swells into each new layer, and a final hit.
//
//   node promo/audio.mjs   →   promo/out/soundtrack.wav (48 kHz, stereo, float)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FINAL_HIT, KIT, PARTS, PLAYED, SECONDS, STEP, TAPE } from "./session.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const timeline = JSON.parse(readFileSync(join(OUT, "timeline.json"), "utf8"));

const SR = 48000;
const N = SR * SECONDS;
const TAU = Math.PI * 2;

/* --- buses ------------------------------------------------------------------ */

const stereo = () => [new Float32Array(N), new Float32Array(N)];
const drumsBus = stereo(); // never ducked
const musicBus = stereo(); // ducked by the kick
const fxBus = stereo(); // sound design
const reverbSend = new Float32Array(N);
const delaySend = new Float32Array(N);

function pan(p) {
  const a = ((p + 1) * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)];
}
function put(bus, i, l, r) {
  if (i >= 0 && i < N) {
    bus[0][i] += l;
    bus[1][i] += r;
  }
}

/* --- building blocks ---------------------------------------------------------- */

const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);

let seed = 22222;
function noise() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) / 4294967296) * 2 - 1;
}

function blep(t, dt) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}
const saw = (p, dt) => 2 * p - 1 - blep(p, dt);
const pulse = (p, dt, w) => (p < w ? 1 : -1) + blep(p, dt) - blep((p + 1 - w) % 1, dt);

/** Zero-delay state-variable filter (lowpass, bandpass, highpass in one). */
class Filter {
  constructor() {
    this.a = 0;
    this.b = 0;
  }
  run(x, fc, q) {
    const g = Math.tan((Math.PI * Math.min(Math.max(fc, 20), SR * 0.45)) / SR);
    const k = 1 / q;
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x - this.b;
    const v1 = a1 * this.a + a2 * v3;
    const v2 = this.b + a2 * this.a + a3 * v3;
    this.a = 2 * v1 - this.a;
    this.b = 2 * v2 - this.b;
    this.lp = v2;
    this.bp = v1;
    this.hp = x - k * v1 - v2;
    return v2;
  }
}

/** Attack, then decay to a sustain while held, then release. */
function env(t, gate, attack, decay, sustain, release) {
  const held = (u) => (u < attack ? u / attack : sustain + (1 - sustain) * Math.exp(-(u - attack) / decay));
  return t < gate ? held(t) : held(gate) * Math.exp(-(t - gate) / release);
}

/* --- instruments --------------------------------------------------------------- */

function bass(t0, gate, note) {
  const f = mtof(note);
  const dt = f / SR;
  const lp = new Filter();
  let p1 = 0, p2 = 0.37, ps = 0;
  const i0 = Math.round(t0 * SR);
  const len = Math.round((gate + 0.4) * SR);
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    const a = env(t, gate, 0.003, 0.14, 0.7, 0.06);
    p1 = (p1 + dt) % 1;
    p2 = (p2 + dt * 1.0046) % 1;
    ps = (ps + dt) % 1;
    let x = 0.42 * saw(p1, dt) + 0.32 * saw(p2, dt * 1.0046) + 0.5 * Math.sin(TAU * ps);
    x = lp.run(x, 150 + 2400 * Math.exp(-t / 0.085), 1.3);
    x = Math.tanh(1.7 * x) / Math.tanh(1.7);
    const y = x * a * 0.4;
    put(musicBus, i0 + k, y, y);
  }
}

function chordVoice(t0, gate, note, i) {
  const f = mtof(note);
  const det = [-0.07, 0, 0.07].map((c) => Math.pow(2, c / 12));
  const ph = [0.11 * i, 0.5, 0.83 - 0.07 * i];
  const lpL = new Filter(), lpR = new Filter();
  const i0 = Math.round(t0 * SR);
  const len = Math.round((gate + 1.0) * SR);
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    const a = env(t, gate, 0.006, 0.25, 0.55, 0.2);
    let s = [0, 0, 0];
    for (let o = 0; o < 3; o++) {
      const dt = (f * det[o]) / SR;
      ph[o] = (ph[o] + dt) % 1;
      s[o] = saw(ph[o], dt);
    }
    const fc = 700 + 2600 * Math.exp(-t / 0.16);
    const l = lpL.run(s[0] + 0.7 * s[1], fc, 0.9);
    const r = lpR.run(s[2] + 0.7 * s[1], fc, 0.9);
    put(musicBus, i0 + k, l * a * 0.055, r * a * 0.055);
    if (i0 + k < N) reverbSend[i0 + k] += (l + r) * a * 0.012;
  }
}

function lead(t0, gate, note) {
  const f = mtof(note);
  const lp = new Filter();
  let p = 0, q = 0.25;
  const i0 = Math.round(t0 * SR);
  const len = Math.round((gate + 0.6) * SR);
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    const vib = 1 + 0.006 * Math.sin(TAU * 5.4 * t) * Math.min(1, Math.max(0, (t - 0.12) / 0.2));
    const dt = (f * vib) / SR;
    p = (p + dt) % 1;
    q = (q + dt * 1.003) % 1;
    const a = env(t, gate, 0.004, 0.18, 0.7, 0.14);
    let x = 0.6 * pulse(p, dt, 0.32) + 0.35 * saw(q, dt);
    x = lp.run(x, 2200 + 3000 * Math.exp(-t / 0.15), 0.8);
    const y = x * a * 0.13;
    put(musicBus, i0 + k, y * 0.95, y);
    if (i0 + k < N) {
      delaySend[i0 + k] += y * 0.5;
      reverbSend[i0 + k] += y * 0.2;
    }
  }
}

/** The test sound: a small FM chime. */
function chime(t0, note, side) {
  const f = mtof(note);
  let pc = 0, pm = 0;
  const [gl, gr] = pan(side);
  const i0 = Math.round(t0 * SR);
  const len = Math.round(1.6 * SR);
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    pm = (pm + (f * 2) / SR) % 1;
    const index = 2.2 * Math.exp(-t / 0.12);
    pc = (pc + f / SR) % 1;
    const a = Math.min(1, t / 0.002) * Math.exp(-t / 0.42);
    const y = Math.sin(TAU * pc + index * Math.sin(TAU * pm)) * a * 0.2;
    put(fxBus, i0 + k, y * gl, y * gr);
    if (i0 + k < N) reverbSend[i0 + k] += y * 0.5;
  }
}

function kick(t0, gain = 0.9) {
  let ph = 0;
  const i0 = Math.round(t0 * SR);
  const len = Math.round(0.6 * SR);
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    const f = 44 + 120 * Math.exp(-t / 0.032);
    ph = (ph + f / SR) % 1;
    const a = Math.min(1, t / 0.001) * Math.exp(-t / 0.26);
    let x = Math.sin(TAU * ph) * a + noise() * Math.exp(-t / 0.0015) * 0.25;
    x = Math.tanh(1.6 * x);
    put(drumsBus, i0 + k, x * gain, x * gain);
  }
}

function snare(t0) {
  const bp = new Filter(), hp = new Filter(), cl = new Filter();
  let ph = 0;
  const i0 = Math.round(t0 * SR);
  const len = Math.round(0.45 * SR);
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    ph = (ph + (185 + 40 * Math.exp(-t / 0.01)) / SR) % 1;
    const tone = Math.sin(TAU * ph) * Math.exp(-t / 0.05) * 0.45;
    const n = noise();
    bp.run(n, 1900, 0.7);
    hp.run(bp.bp, 900, 0.7);
    const body = hp.hp * Math.exp(-t / 0.15) * 1.1;
    // A clap's three quick hands, under the noise.
    let clapEnv = 0;
    for (const o of [0, 0.011, 0.022]) if (t >= o) clapEnv += Math.exp(-(t - o) / 0.007);
    cl.run(n, 1300, 1.2);
    const clap = cl.bp * clapEnv * 0.9;
    const x = (tone + body + clap) * 0.42;
    put(drumsBus, i0 + k, x, x);
    if (i0 + k < N) reverbSend[i0 + k] += x * 0.35;
  }
}

const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800].map((f) => f * 1.7);
function hat(t0, decay, gain, side) {
  const ph = METAL.map((_, j) => j * 0.13);
  const bp = new Filter(), hp = new Filter();
  const [gl, gr] = pan(side);
  const i0 = Math.round(t0 * SR);
  const len = Math.round((decay * 6 + 0.02) * SR);
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    let m = 0;
    for (let j = 0; j < METAL.length; j++) {
      ph[j] = (ph[j] + METAL[j] / SR) % 1;
      m += ph[j] < 0.5 ? 1 : -1;
    }
    m = m / 6 + noise() * 0.4;
    bp.run(m, 9500, 0.9);
    hp.run(bp.bp, 7000, 0.7);
    const x = hp.hp * Math.min(1, t / 0.0008) * Math.exp(-t / decay) * gain;
    put(drumsBus, i0 + k, x * gl, x * gr);
  }
}

function crash(t0, gain = 0.25) {
  const hp = new Filter();
  const ph = METAL.map((_, j) => j * 0.21);
  const i0 = Math.round(t0 * SR);
  const len = Math.min(N - i0, Math.round(2.4 * SR));
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    let m = 0;
    for (let j = 0; j < METAL.length; j++) {
      ph[j] = (ph[j] + (METAL[j] * 1.37) / SR) % 1;
      m += ph[j] < 0.5 ? 1 : -1;
    }
    hp.run(noise() * 0.8 + (m / 6) * 0.5, 4200, 0.7);
    const x = hp.hp * Math.min(1, t / 0.002) * Math.exp(-t / 0.9) * gain;
    put(fxBus, i0 + k, x * 0.9, x);
    if (i0 + k < N) reverbSend[i0 + k] += x * 0.4;
  }
}

/* --- sound design ---------------------------------------------------------------- */

function riser(t0, t1, gain) {
  const bpL = new Filter(), bpR = new Filter();
  let ph = 0;
  const i0 = Math.round(t0 * SR);
  const len = Math.round((t1 - t0) * SR);
  for (let k = 0; k < len; k++) {
    const u = k / len;
    const fc = 220 * Math.pow(36, u);
    bpL.run(noise(), fc, 1.6);
    bpR.run(noise(), fc * 1.03, 1.6);
    ph = (ph + (110 * Math.pow(8, u)) / SR) % 1;
    const a = u * u * gain;
    const s = Math.sin(TAU * ph) * 0.18;
    put(fxBus, i0 + k, (bpL.bp * 2.2 + s) * a, (bpR.bp * 2.2 + s) * a);
    reverbSend[i0 + k] += bpL.bp * a * 0.4;
  }
}

/** The intro pad: D minor, fading in under the riser. */
function pad(t0, t1) {
  const notes = [50, 53, 57, 62];
  const ph = notes.map(() => 0);
  const lp = new Filter();
  const i0 = Math.round(t0 * SR);
  const len = Math.round((t1 - t0) * SR);
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    let x = 0;
    for (let j = 0; j < notes.length; j++) {
      const dt = (mtof(notes[j]) * (1 + 0.0015 * Math.sin(TAU * 0.3 * t + j))) / SR;
      ph[j] = (ph[j] + dt) % 1;
      x += saw(ph[j], dt);
    }
    x = lp.run(x, 300 + 1400 * (t / (t1 - t0)) ** 2, 0.8);
    const a = Math.min(1, t / 1.5) * Math.min(1, (len - k) / (0.02 * SR)) * 0.045;
    put(fxBus, i0 + k, x * a, x * a);
    reverbSend[i0 + k] += x * a * 0.5;
  }
}

function impact(t0) {
  let ph = 0;
  const lp = new Filter();
  const i0 = Math.round(t0 * SR);
  const len = Math.round(1.6 * SR);
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    ph = (ph + (34 + 30 * Math.exp(-t / 0.18)) / SR) % 1;
    const sub = Math.sin(TAU * ph) * Math.exp(-t / 0.55) * 0.55;
    lp.run(noise(), 900, 0.7);
    const burst = lp.lp * Math.exp(-t / 0.2) * 0.5;
    put(fxBus, i0 + k, sub + burst, sub + burst);
    reverbSend[i0 + k] += burst * 0.6;
  }
}

/** A reversed-cymbal swell that cuts on the downbeat. */
function swell(t1, length, gain) {
  const hp = new Filter();
  const i1 = Math.round(t1 * SR);
  const len = Math.round(length * SR);
  for (let k = 0; k < len; k++) {
    const u = k / len;
    hp.run(noise(), 2500 + 4000 * u, 0.7);
    const x = hp.hp * Math.pow(u, 2.5) * gain;
    put(fxBus, i1 - len + k, x, x * 0.9);
    reverbSend[i1 - len + k] += x * 0.2;
  }
}

/* --- the score -------------------------------------------------------------------- */

const sec = (ms) => ms / 1000;
const partAt = (ms) => [...PARTS].reverse().find((p) => ms >= p.from).part;

// Note-ons paired with their note-offs, from what the app sent.
const midi = timeline.midi;
const notes = [];
for (let i = 0; i < midi.length; i++) {
  const m = midi[i];
  if ((m.d[0] & 0xf0) !== 0x90 || m.d[2] === 0) continue;
  const off = midi.slice(i + 1).find((o) => ((o.d[0] & 0xf0) === 0x80 || ((o.d[0] & 0xf0) === 0x90 && o.d[2] === 0)) && o.d[1] === m.d[1] && o.t > m.t);
  notes.push({ t: m.t, note: m.d[1], len: (off ? off.t : m.t + 100) - m.t, part: partAt(m.t) });
}
const live = notes.filter((n) => n.t < FINAL_HIT - 1);

// What's on tape: the part as it played in the loop before it was recorded,
// looping from when it plays back until the final hit.
const LOOP = 32 * STEP;
const taped = [];
for (const layer of TAPE) {
  const take = live.filter((n) => n.part === layer.part && n.t >= layer.recordedFrom && n.t < layer.recordedFrom + LOOP);
  for (let start = layer.playsFrom; start < FINAL_HIT - 1; start += LOOP) {
    for (const n of take) taped.push({ ...n, t: n.t - layer.recordedFrom + start });
  }
}

const kicks = [];
function drum(ms, note, gain = 1) {
  const t = sec(ms);
  if (note === KIT.kick) {
    kick(t, 0.9 * gain);
    kicks.push(t);
  } else if (note === KIT.snare) snare(t);
  else if (note === KIT.hat) hat(t, 0.034, 0.32, 0.25);
  else if (note === KIT.open) hat(t, 0.2, 0.26, 0.25);
}

let chordIndex = 0;
for (const n of [...live, ...taped].sort((a, b) => a.t - b.t)) {
  if (n.part === "test") chime(sec(n.t), n.note, [-0.4, 0, 0.4][chordIndex++ % 3]);
  else if (n.part === "bass") bass(sec(n.t), sec(n.len), n.note);
  else if (n.part === "drums") drum(n.t, n.note);
  else if (n.part === "chords") chordVoice(sec(n.t), sec(n.len), n.note, n.note % 3);
}

// What you play on the OP-1's keys.
for (const [ms, note, len] of PLAYED) {
  if (ms >= 14000 && ms < 15500) drum(ms, note, 0.8);
  else lead(sec(ms), sec(len), note);
}

// The ad's sound design.
pad(0, 3.875);
riser(0.2, 3.875, 0.5);
impact(4.0);
crash(4.0, 0.2);
kicks.push(4.0);
swell(12.0, 1.2, 0.16);
swell(16.0, 1.5, 0.2);
swell(20.0, 1.5, 0.2);
swell(sec(FINAL_HIT), 2.0, 0.26);

// The final hit: everything on D minor, ringing out.
const hit = sec(FINAL_HIT);
kick(hit, 1.0);
kicks.push(hit);
impact(hit);
crash(hit, 0.3);
bass(hit, 1.4, 38);
for (const [j, note] of [50, 53, 57, 62].entries()) chordVoice(hit, 1.3, note, j);
lead(hit, 1.1, 74);

/* --- effects and mix -------------------------------------------------------------- */

/** Freeverb: eight combs and four allpasses a side. */
function reverb(input) {
  const scale = SR / 44100;
  const combs = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116];
  const out = stereo();
  for (const [side, spread] of [[0, 0], [1, 23]]) {
    const cs = combs.map((c) => ({ buf: new Float32Array(Math.round((c + spread) * scale)), i: 0, store: 0 }));
    const as = [556, 441, 341, 225].map((a) => ({ buf: new Float32Array(Math.round((a + spread) * scale)), i: 0 }));
    for (let n = 0; n < N; n++) {
      const x = input[n] * 0.5;
      let y = 0;
      for (const c of cs) {
        const o = c.buf[c.i];
        c.store = o * 0.75 + c.store * 0.25;
        c.buf[c.i] = x + c.store * 0.86;
        c.i = (c.i + 1) % c.buf.length;
        y += o;
      }
      for (const a of as) {
        const o = a.buf[a.i];
        a.buf[a.i] = y + o * 0.5;
        a.i = (a.i + 1) % a.buf.length;
        y = o - y;
      }
      out[side][n] = y;
    }
  }
  return out;
}

/** Ping-pong delay, three sixteenths, darker on each repeat. */
function pingPong(input) {
  const d = Math.round(sec(3 * STEP) * SR);
  const out = stereo();
  const bl = new Float32Array(d), br = new Float32Array(d);
  let i = 0, lpl = 0, lpr = 0;
  for (let n = 0; n < N; n++) {
    const l = bl[i], r = br[i];
    lpl += (l - lpl) * 0.35;
    lpr += (r - lpr) * 0.35;
    bl[i] = input[n] + lpr * 0.38;
    br[i] = lpl * 0.38;
    i = (i + 1) % d;
    out[0][n] = l;
    out[1][n] = r;
  }
  return out;
}

// The kick ducks the music: the pump.
kicks.sort((a, b) => a - b);
const duck = new Float32Array(N).fill(1);
for (const k of kicks) {
  const i0 = Math.round(k * SR);
  for (let j = 0; j < 0.3 * SR && i0 + j < N; j++) {
    const t = j / SR;
    const g = 1 - 0.5 * Math.min(1, t / 0.004) * Math.exp(-t / 0.1);
    duck[i0 + j] = Math.min(duck[i0 + j], g);
  }
}

const verb = reverb(reverbSend);
// Reverb builds up low end; keep it above 200 Hz so it doesn't muddy the bass.
for (const ch of verb) {
  const hp = new Filter();
  for (let n = 0; n < N; n++) {
    hp.run(ch[n], 200, 0.7);
    ch[n] = hp.hp;
  }
}
const echo = pingPong(delaySend);
const master = stereo();
for (let s = 0; s < 2; s++) {
  for (let n = 0; n < N; n++) {
    master[s][n] = drumsBus[s][n] + musicBus[s][n] * duck[n] + fxBus[s][n] + verb[s][n] * 0.32 + echo[s][n] * 0.9 * duck[n];
  }
}

// Level: bring the peak up to a soft limiter, then to -1 dBFS.
let peak = 0;
for (const ch of master) for (const v of ch) peak = Math.max(peak, Math.abs(v));
const drive = 1.25 / peak;
const ceiling = Math.pow(10, -1 / 20);
const fadeOut = (n) => Math.min(1, Math.max(0, (SECONDS - n / SR) / 0.6));
const fadeIn = (n) => Math.min(1, n / (0.01 * SR));
for (const ch of master) {
  for (let n = 0; n < N; n++) ch[n] = (Math.tanh(ch[n] * drive) / Math.tanh(1.25)) * ceiling * fadeOut(n) * fadeIn(n);
}

/* --- write the WAV (32-bit float) ---------------------------------------------------- */

const data = Buffer.alloc(N * 2 * 4);
for (let n = 0; n < N; n++) {
  data.writeFloatLE(master[0][n], n * 8);
  data.writeFloatLE(master[1][n], n * 8 + 4);
}
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(3, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 8, 28);
header.writeUInt16LE(8, 32);
header.writeUInt16LE(32, 34);
header.write("data", 36);
header.writeUInt32LE(data.length, 40);
writeFileSync(join(OUT, "soundtrack.wav"), Buffer.concat([header, data]));

let nan = 0;
for (const ch of master) for (const v of ch) if (!Number.isFinite(v)) nan++;
const parts = {};
for (const n of [...live, ...taped]) parts[n.part] = (parts[n.part] ?? 0) + 1;
console.log(`rendered ${SECONDS}s: notes by part ${JSON.stringify(parts)}, played ${PLAYED.length}, kicks ${kicks.length}, peak before limiter ${peak.toFixed(2)}, bad samples ${nan}`);
