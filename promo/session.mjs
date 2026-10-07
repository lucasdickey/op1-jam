// The scripted session the teaser shows: what Claude "writes", what you play
// on the OP-1, and when each button is pressed. Times are milliseconds from the
// start of the video. 120 BPM: a beat is 500 ms, a sixteenth 125 ms, and the
// two-bar loop 4000 ms.
//
// The patterns are stand-ins written for the video, in D minor:
// Dm | F | Bb | C, a half bar each.

export const FPS = 30;
export const SECONDS = 30;
export const TEMPO = 120;
export const STEP = 60000 / TEMPO / 4;

const n = (step, note, length) => ({ step, note, length });
const chord = (step, length, notes) => notes.map((note) => n(step, note, length));

export const BASS_A = {
  bars: 2,
  notes: [
    n(0, 38, 2), n(3, 38, 1), n(6, 50, 1), n(8, 41, 2), n(11, 41, 1), n(14, 48, 1),
    n(16, 34, 2), n(19, 34, 1), n(22, 46, 1), n(24, 36, 2), n(27, 36, 1), n(28, 43, 2), n(30, 45, 2),
  ],
};

export const BASS_B = {
  bars: 2,
  notes: [
    n(0, 38, 2), n(3, 38, 1), n(6, 50, 1), n(8, 41, 2), n(11, 41, 1), n(14, 48, 1),
    n(16, 34, 2), n(19, 34, 1), n(22, 41, 1), n(24, 45, 2), n(26, 48, 2), n(28, 50, 4),
  ],
};

/** The kit's keys, as the app learns them: kick, snare, closed and open hat. */
export const KIT = { kick: 53, snare: 55, hat: 57, open: 58 };

export const DRUMS = {
  bars: 2,
  notes: [
    ...[0, 4, 8, 12, 16, 20, 24, 28].map((s) => n(s, KIT.kick, 1)),
    ...[4, 12, 20, 28].map((s) => n(s, KIT.snare, 1)),
    ...[2, 6, 10, 14, 18, 22, 26].map((s) => n(s, KIT.hat, 1)),
    n(30, KIT.open, 2),
  ],
};

const DM = [50, 53, 57];
const F_C = [48, 53, 57];
const BB_D = [50, 53, 58];
const C = [48, 52, 55];
export const CHORDS = {
  bars: 2,
  notes: [
    ...chord(0, 4, DM), ...chord(6, 2, DM),
    ...chord(8, 4, F_C), ...chord(14, 2, F_C),
    ...chord(16, 4, BB_D), ...chord(22, 2, BB_D),
    ...chord(24, 4, C), ...chord(30, 2, C),
  ],
};

/** Claude's answers, released into the app at these times. */
export const ANSWERS = [
  { at: 3800, ms: 3400, pattern: BASS_A, note: "A sparse D minor line: root on the one, fifth on the and of two." },
  { at: 11000, ms: 2900, pattern: BASS_B, note: "Same line, now climbing up to D in bar 2 to answer your F–A–G." },
  { at: 15600, ms: 3100, pattern: DRUMS, note: "Four on the floor, claps on two and four, hats on the offbeat." },
  { at: 19650, ms: 3600, pattern: CHORDS, note: "Dm, F, B♭, C — short stabs, so the bass on tape stays out front." },
];

/** Button presses: [time, what]. */
export const CLICKS = [
  [1000, "test"],
  [1940, "play"],
  [10200, "write"],
  [14200, "tape"],
  [14450, "drums"],
  [15350, "write"],
  [19000, "tape"],
  [19250, "chords"],
  [19400, "write"],
  [28000, "play"],
];

/** Keys you play on the OP-1: [start, note, length in ms]. */
const at = (loopStart, steps) => steps.map(([s, note, len]) => [loopStart + s * STEP, note, len * STEP]);
export const PLAYED = [
  // Play along: F, A, G over the bassline.
  [8500, 65, 250], [8750, 69, 250], [9000, 67, 500],
  // Teaching the app the drum kit: a fill on the four keys.
  [14500, KIT.kick, 100], [14750, KIT.snare, 100], [15000, KIT.hat, 100], [15250, KIT.open, 150],
  // A lead line over the chords.
  ...at(20000, [[2, 69, 2], [4, 72, 2], [6, 74, 4], [11, 72, 1], [12, 69, 3], [16, 70, 2], [18, 74, 2], [20, 77, 4], [24, 76, 3], [27, 74, 1], [28, 72, 3]]),
];

/** What is on the OP-1's tape, and from when it plays back. */
export const TAPE = [
  { part: "bass", recordedFrom: 12000, playsFrom: 16000 },
  { part: "drums", recordedFrom: 16000, playsFrom: 20000 },
];

/** Which part the app is sending, from when. */
export const PARTS = [
  { part: "test", from: 0 },
  { part: "bass", from: 4000 },
  { part: "drums", from: 16000 },
  { part: "chords", from: 20000 },
];

export const FINAL_HIT = 28000;
