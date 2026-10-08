// Turning a hum into a loop, on synthetic voices. Plain Node, no app:
// `npm run test:hum`.

import { detectPitch, fitHum, guessKey, hzToMidi, keyName, level, noiseGate, segment, type HumFrame } from "../src/shared/hum.ts";

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`}`);
}

const SR = 24000;
const WINDOW = 1024;
const HOP = 256;
const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** A hum-like voice: a fundamental with a few overtones, a little vibrato, some noise. */
function voice(notes: { at: number; dur: number; midi: number }[], seconds: number, seed = 1): Float32Array {
  const out = new Float32Array(Math.ceil(seconds * SR));
  let rand = seed;
  const noise = () => ((rand = (rand * 16807) % 2147483647) / 2147483647 - 0.5) * 0.004;
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const n = notes.find((x) => t >= x.at && t < x.at + x.dur);
    out[i] = noise();
    if (!n) continue;
    const hz = midiHz(n.midi) * (1 + 0.004 * Math.sin(2 * Math.PI * 5.5 * t));
    phase += (2 * Math.PI * hz) / SR;
    const env = Math.min(1, (t - n.at) / 0.02, (n.at + n.dur - t) / 0.02);
    out[i] += env * 0.2 * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase));
  }
  return out;
}

/** The mic's readings of a recording, as the page makes them. */
function frames(audio: Float32Array): HumFrame[] {
  const out: HumFrame[] = [];
  for (let i = 0; i + WINDOW <= audio.length; i += HOP) {
    const buf = audio.subarray(i, i + WINDOW);
    const p = detectPitch(buf, SR);
    out.push({ time: ((i + WINDOW / 2) / SR) * 1000, level: level(buf), midi: p && p.clarity > 0.6 ? hzToMidi(p.hz) : null });
  }
  return out;
}

/* --- pitch ---------------------------------------------------------------- */

for (const m of [40, 48, 57, 69, 81]) {
  const p = detectPitch(voice([{ at: 0, dur: 1, midi: m }], 0.1).subarray(0, WINDOW), SR);
  check(`hears ${m} as ${m}`, p ? Math.round(hzToMidi(p.hz)) : null, m);
}
check("silence has no pitch", detectPitch(new Float32Array(WINDOW), SR), null);

/* --- notes ---------------------------------------------------------------- */

// 120 BPM: a step is 125 ms. "da da da": D4 E4 F4, an eighth each with a gap, then A4 held a beat.
const tune = [
  { at: 0.5, dur: 0.22, midi: 62 },
  { at: 0.75, dur: 0.22, midi: 64 },
  { at: 1.0, dur: 0.22, midi: 65 },
  { at: 1.25, dur: 0.48, midi: 69 },
];
const heard = frames(voice(tune, 2));
const gate = noiseGate(heard.filter((f) => f.time < 400));
const raw = segment(heard, gate);
check("four notes", raw.length, 4);
check("at the right pitches", raw.map((r) => Math.round(r.pitch)), [62, 64, 65, 69]);
check("starting within a step of where they were sung", raw.every((r, i) => Math.abs(r.start - tune[i].at * 1000) < 62), true);

// A glide straight from one note into the next, no gap: still two notes.
const legato = segment(frames(voice([{ at: 0.2, dur: 0.4, midi: 60 }, { at: 0.6, dur: 0.4, midi: 67 }], 1.2)), 0.01);
check("a jump in pitch starts a new note", legato.map((r) => Math.round(r.pitch)), [60, 67]);

/* --- the loop ------------------------------------------------------------- */

// The same tune hummed slightly flat and early, as people do.
const sloppy = [
  { start: 480, end: 700, pitch: 61.7 },
  { start: 745, end: 960, pitch: 64.2 },
  { start: 1010, end: 1220, pitch: 64.6 },
  { start: 1240, end: 1720, pitch: 68.8 },
];
const lead = fitHum(sloppy, { start: 500, stepMs: 125, bars: 1, part: "lead" });
check(
  "lands on the grid, in key, held to the next note",
  lead.pattern.notes,
  [
    { step: 0, note: 62, length: 2 },
    { step: 2, note: 64, length: 2 },
    { step: 4, note: 65, length: 2 },
    { step: 6, note: 69, length: 4 },
  ],
);

const bass = fitHum(sloppy, { start: 500, stepMs: 125, bars: 1, part: "bass" });
check("a bass line hummed high moves down into the bass range", bass.pattern.notes.map((n) => n.note), [38, 40, 41, 45]);

const low = fitHum([{ start: 0, end: 500, pitch: 48 }, { start: 500, end: 1000, pitch: 52 }], { start: 0, stepMs: 125, bars: 1, part: "lead" });
check("a lead hummed low moves up an octave", low.pattern.notes.map((n) => n.note), [60, 64]);

// A held E that dropped out for 25 ms mid-note (as a busy Mac's audio can),
// next to two E's sung "da da" on the beat.
const dropped = fitHum(
  [
    { start: 500, end: 690, pitch: 64 },
    { start: 715, end: 870, pitch: 64.1 },
    { start: 1000, end: 1110, pitch: 64 },
    { start: 1125, end: 1240, pitch: 64 },
  ],
  { start: 500, stepMs: 125, bars: 1, part: "lead" },
);
check(
  "a dropout mid-note doesn't split it; a sung repeat does",
  dropped.pattern.notes,
  [
    { step: 0, note: 64, length: 3 },
    { step: 4, note: 64, length: 1 },
    { step: 5, note: 64, length: 1 },
  ],
);

const late = fitHum([{ start: 0, end: 400, pitch: 60 }, { start: 2100, end: 2500, pitch: 62 }], { start: 0, stepMs: 125, bars: 1, part: "lead" });
check("notes past the loop are dropped", late.pattern.notes.length, 1);

// D E F G, with the F hummed between F and F#: it rounds to F unless the
// loop says the song is in D major, where F# belongs.
const between = [62, 64, 65.45, 67].map((pitch, i) => ({ start: i * 250, end: i * 250 + 240, pitch }));
const opts = { start: 0, stepMs: 125, bars: 1 as const, part: "lead" as const };
check("an in-between note rounds to the nearest", fitHum(between, opts).pattern.notes.map((n) => n.note), [62, 64, 65, 67]);
check(
  "…unless the loop's key says otherwise",
  fitHum(between, { ...opts, context: [50, 54, 57, 50, 54, 57, 62, 66] }).pattern.notes.map((n) => n.note),
  [62, 64, 66, 67],
);
check("a C major tune is in C major", keyName(guessKey([60, 62, 64, 65, 67, 60].map((note) => ({ note, weight: 2 })))), "C major");

console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
