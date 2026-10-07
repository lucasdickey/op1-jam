// What the OP-1 jam's browser player and its pattern API say to each other.
// Plain types and constants only, so the client bundle can import this
// without pulling in the model client.

/** The grid is sixteenth notes: sixteen steps to a bar of 4/4. */
export const STEPS_PER_BAR = 16;

/** Loop lengths the page offers, in bars. */
export const LOOP_BARS = [1, 2, 4] as const;
export type LoopBars = (typeof LOOP_BARS)[number];

/**
 * The OP-1 plays incoming notes on whichever instrument is selected, one at a
 * time, so Claude writes one part per pattern and the person says which.
 */
export const PARTS = ["bass", "chords", "lead", "arpeggio", "drums"] as const;
export type Part = (typeof PARTS)[number];

/** The OP-1 has four tape tracks, so at most four parts can be on tape. */
export const MAX_TAPE = 4;

/** One note in a loop: where it starts, which key, how long it holds. */
export interface PatternNote {
  /** Sixteenth-note step from the top of the loop, 0-based. */
  step: number;
  /** MIDI note number; 60 is middle C. */
  note: number;
  /** How many steps it holds, at least 1. */
  length: number;
}

export interface Pattern {
  bars: LoopBars;
  notes: PatternNote[];
}

/**
 * A note the person played on the OP-1 while the loop ran. `step` and
 * `loopsAgo` are null when it was played with the loop stopped — the pitch is
 * still worth knowing (it says what key they are in), the timing isn't.
 */
export interface HeardNote {
  note: number;
  step: number | null;
  loopsAgo: number | null;
  length: number | null;
}

/** A part the person has recorded to the OP-1's tape and wants kept in mind. */
export interface TapeLayer {
  part: Part;
  pattern: Pattern;
}

export interface PatternRequest {
  part: Part;
  tempo: number;
  bars: LoopBars;
  direction: string;
  /** Whether the direction changed since the pattern that's playing was written. */
  newDirection: boolean;
  current: Pattern | null;
  heard: HeardNote[];
  /** Note numbers the drum kit's keys send, learned from what was played. */
  drumKeys: number[];
  tape: TapeLayer[];
}

export interface PatternResponse {
  pattern: Pattern;
  /** One line from Claude about what it wrote or changed. */
  note: string;
  /** How long the model took, for the status line. */
  ms: number;
}

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** MIDI note number to a name with octave: 60 → C4. */
export function noteName(note: number): string {
  return `${NAMES[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`;
}
