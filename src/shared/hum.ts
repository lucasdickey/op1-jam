// Turning a hummed tune into a loop. Pure on purpose, like prompt.ts: no
// audio, no page — so plain Node can run it, as tests/hum.test.ts does. The
// microphone side lives in src/renderer/jam/mic.ts.
//
// Three steps:
// 1. `detectPitch` finds the pitch of a few dozen milliseconds of sound (YIN,
//    de Cheveigné & Kawahara 2002 — the usual method for a single voice).
// 2. `segment` strings those readings into notes: a note starts where the
//    voice starts or jumps to a new pitch, and ends where it stops.
// 3. `fitHum` puts the notes on the loop's grid, in one key, in the part's
//    octave.

import { noteName, STEPS_PER_BAR, type Part, type Pattern, type PatternNote } from "./types.ts";

/* --- 1. Pitch ------------------------------------------------------------- */

/** Lowest and highest pitch a hum is looked for at: a low C to a high B. */
export const MIN_HZ = 65;
export const MAX_HZ = 1000;
/** YIN's threshold: lower is stricter about what counts as a pitch. */
const THRESHOLD = 0.15;

export interface PitchReading {
  hz: number;
  /** 0–1: how cleanly periodic the sound is. A sung note is ~0.9. */
  clarity: number;
}

/**
 * The pitch of `buf`, or null if it has none (breath, a consonant, silence).
 * `buf` should hold at least two periods of the lowest pitch plus a window.
 */
export function detectPitch(buf: Float32Array, sampleRate: number): PitchReading | null {
  const tauMax = Math.min(Math.floor(sampleRate / MIN_HZ), Math.floor(buf.length / 2));
  const tauMin = Math.max(2, Math.floor(sampleRate / MAX_HZ));
  const w = buf.length - tauMax;
  if (w < tauMax) return null;

  // The difference function: how unlike the sound is to itself `tau` later.
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let j = 0; j < w; j++) {
      const x = buf[j] - buf[j + tau];
      sum += x * x;
    }
    d[tau] = sum;
  }
  // Normalised by its running mean, so the first dip under the threshold is
  // the period and not one of its multiples.
  let running = 0;
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    cmnd[tau] = running === 0 ? 1 : (d[tau] * tau) / running;
  }

  let tau = tauMin;
  for (; tau < tauMax; tau++) {
    if (cmnd[tau] < THRESHOLD) {
      while (tau + 1 < tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
      break;
    }
  }
  if (tau >= tauMax) return null;

  // Between samples: fit a parabola through the dip and its neighbours.
  const a = cmnd[tau - 1];
  const b = cmnd[tau];
  const c = cmnd[tau + 1];
  const bend = a + c - 2 * b;
  const exact = bend > 0 ? tau + (a - c) / (2 * bend) : tau;
  return { hz: sampleRate / exact, clarity: Math.max(0, Math.min(1, 1 - b)) };
}

/** Frequency to a MIDI note number with a fraction: 440 → 69. */
export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

/** Root-mean-square level of `buf`, 0–1. */
export function level(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

/* --- 2. Notes ------------------------------------------------------------- */

/** One reading of the mic: when, how loud, and the pitch if there is one. */
export interface HumFrame {
  /** Milliseconds on the page's clock (performance.now()). */
  time: number;
  level: number;
  /** MIDI note number with a fraction, or null for no pitch. */
  midi: number | null;
}

/** A hummed note before it is put on the grid. */
export interface RawNote {
  start: number;
  end: number;
  /** MIDI note number with a fraction. */
  pitch: number;
}

/** A note shorter than this is a scoop, a click or a cough. */
const MIN_NOTE_MS = 70;
/** How far the voice has to move, in semitones, to count as a new note. */
const JUMP = 0.75;
/** …and for how many readings in a row, so a wobble doesn't split a note. */
const JUMP_FRAMES = 3;
/** Missing readings bridged inside a note, so one bad reading doesn't split it. */
const GAP_FRAMES = 1;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * The quietest a frame can be and still count as voice: a few times the room's
 * own noise, from frames recorded before the person started.
 */
export function noiseGate(quiet: HumFrame[]): number {
  if (quiet.length === 0) return 0.01;
  return Math.min(0.05, Math.max(0.004, median(quiet.map((f) => f.level)) * 3));
}

/** String readings, in time order, into notes. */
export function segment(frames: HumFrame[], gate: number): RawNote[] {
  const notes: RawNote[] = [];
  let cur: HumFrame[] = [];
  let jump: HumFrame[] = [];
  let missed = 0;
  const hop = frames.length > 1 ? (frames[frames.length - 1].time - frames[0].time) / (frames.length - 1) : 10;

  const close = (end: number) => {
    if (cur.length > 0) {
      const start = cur[0].time;
      // The first fifth of a note is often a scoop up to the pitch; skip it.
      const settled = cur.slice(Math.floor(cur.length / 5)).map((f) => f.midi!);
      if (end - start >= MIN_NOTE_MS) notes.push({ start, end, pitch: median(settled) });
    }
    cur = [];
    jump = [];
  };

  for (const f of frames) {
    const voiced = f.midi !== null && f.level >= gate;
    if (!voiced) {
      missed += 1;
      if (missed > GAP_FRAMES && cur.length > 0) close(cur[cur.length - 1].time + hop);
      continue;
    }
    missed = 0;
    if (cur.length === 0) {
      cur.push(f);
      continue;
    }
    const here = median(cur.slice(-8).map((g) => g.midi!));
    if (Math.abs(f.midi! - here) > JUMP) {
      // Off the note; a new note only if it stays off, and stays together.
      if (jump.length > 0 && Math.abs(f.midi! - jump[jump.length - 1].midi!) > JUMP) jump = [];
      jump.push(f);
      if (jump.length >= JUMP_FRAMES) {
        const next = jump;
        close(next[0].time);
        cur = next;
      }
    } else {
      cur.push(...jump, f);
      jump = [];
    }
  }
  if (cur.length > 0) close(cur[cur.length - 1].time + hop);
  return notes;
}

/* --- 3. The loop ---------------------------------------------------------- */

/** Where each part sits on the keyboard, as the prompt tells Claude. */
export const PART_RANGE: Record<Exclude<Part, "drums">, [number, number]> = {
  bass: [28, 55],
  chords: [45, 79],
  lead: [57, 88],
  arpeggio: [45, 84],
};

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const KEY_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

export interface Key {
  root: number;
  minor: boolean;
}

export function keyName(key: Key): string {
  return `${KEY_NAMES[key.root]} ${key.minor ? "minor" : "major"}`;
}

function inKey(note: number, key: Key): boolean {
  return (key.minor ? MINOR : MAJOR).includes((((note - key.root) % 12) + 12) % 12);
}

/**
 * The key that fits the most of the tune, longer notes counting more. Notes
 * already in the loop or on tape count too, so the hum lands in their key.
 * Between a major key and its relative minor, the one whose root (and fifth)
 * the tune leans on wins.
 */
export function guessKey(notes: { note: number; weight: number }[]): Key {
  let best: Key = { root: 0, minor: false };
  let bestScore = -Infinity;
  for (let root = 0; root < 12; root++) {
    for (const minor of [false, true]) {
      const key = { root, minor };
      let score = 0;
      for (const n of notes) {
        if (inKey(n.note, key)) score += n.weight;
        if ((((n.note - root) % 12) + 12) % 12 === 0) score += n.weight * 0.5;
        if ((((n.note - root - 7) % 12) + 12) % 12 === 0) score += n.weight * 0.2;
      }
      if (score > bestScore + 1e-9) {
        bestScore = score;
        best = key;
      }
    }
  }
  return best;
}

/** The nearest note in the key, deciding by the pitch as hummed. */
function snap(pitch: number, key: Key): number {
  const near = Math.round(pitch);
  if (inKey(near, key)) return near;
  // A note outside a major or minor key always has both neighbours inside it.
  return pitch >= near ? near + 1 : near - 1;
}

/**
 * The octave shift that puts the most notes in the part's range, moving as
 * little as it can: a tune already in range stays where it was hummed.
 */
function octaveShift(notes: number[], [lo, hi]: [number, number]): number {
  let best = 0;
  let bestCost = Infinity;
  for (let k = -4; k <= 4; k++) {
    const shift = k * 12;
    const outside = notes.filter((n) => n + shift < lo || n + shift > hi).length;
    const cost = outside * 100 + Math.abs(k);
    if (cost < bestCost) {
      bestCost = cost;
      best = shift;
    }
  }
  return best;
}

export interface FitOptions {
  /** When step 0 of the hum sounded, on the page's clock. */
  start: number;
  stepMs: number;
  bars: Pattern["bars"];
  part: Exclude<Part, "drums">;
  /** Notes already in play (the loop, tape), to choose the key with. */
  context?: number[];
}

export interface HumTake {
  pattern: Pattern;
  key: Key;
}

/**
 * The hummed notes as a loop: on the nearest step, in one key, one note at a
 * time, moved by whole octaves into the part's range.
 */
export function fitHum(raw: RawNote[], opts: FitOptions): HumTake {
  const total = opts.bars * STEPS_PER_BAR;
  const placed: { step: number; length: number; pitch: number }[] = [];
  for (const r of raw) {
    let step = Math.round((r.start - opts.start) / opts.stepMs);
    const end = Math.round((r.end - opts.start) / opts.stepMs);
    if (step < 0) step = 0;
    if (step >= total || end <= step) continue;
    placed.push({ step, length: Math.min(end, total) - step, pitch: r.pitch });
  }

  const key = guessKey([
    ...placed.map((p) => ({ note: Math.round(p.pitch), weight: p.length })),
    ...(opts.context ?? []).map((note) => ({ note, weight: 1 })),
  ]);

  // One note at a time: two on one step keep the longer; each note ends
  // where the next begins.
  placed.sort((a, b) => a.step - b.step || b.length - a.length);
  const mono = placed.filter((p, i) => i === 0 || placed[i - 1].step !== p.step);
  const notes: PatternNote[] = mono.map((p, i) => ({
    step: p.step,
    note: snap(p.pitch, key),
    length: Math.max(1, Math.min(p.length, (mono[i + 1]?.step ?? total) - p.step)),
  }));

  const shift = notes.length > 0 ? octaveShift(notes.map((n) => n.note), PART_RANGE[opts.part]) : 0;
  return {
    pattern: {
      bars: opts.bars,
      notes: notes.map((n) => ({ ...n, note: Math.min(127, Math.max(0, n.note + shift)) })),
    },
    key,
  };
}

/** "D4 F4 A4": the notes of a take, for the status line. */
export function describeTake(take: HumTake): string {
  return take.pattern.notes.map((n) => noteName(n.note)).join(" ");
}
