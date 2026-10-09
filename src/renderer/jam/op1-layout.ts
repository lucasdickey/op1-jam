// Where everything is on an original OP-1, measured from photos of a real
// one. The top is a grid of 17 columns by 6 rows of 16 mm squares (the body is
// about 282 × 102 × 13 mm). Both the flat drawing (op1-device.tsx) and the 3D
// one (op1-3d.ts) are built from this, so they always agree.
//
//   col: 0      2      4         8      10     12     14     16
//   r0  [speaker][volume][ screen  ][blue  ][green ][white ][orange][mic]
//   r1  [   ..   ][?][♩] [   ..    ][  ..  ][  ..  ][  ..  ][  ..  ][COM]
//   r2  [∿][◎][oo][ılı][T1][T2][T3][T4][1][2][3][4][5][6][7][8][seq]
//   r3  [lift][drop][split][ black keys ..............................]
//   r4  [rec][play][stop]  [ white keys, two rows tall, F to E .........]
//   r5  [ ‹ ][ › ][shift]  [ ...........................................]
//
// The right-hand edge (the short end by the keys) has, front to back: a strap
// slot, the power switch, mini USB, two 3.5 mm jacks, another strap slot.

export type KeyId =
  | "help" | "tempo" | "synth" | "drum" | "tape" | "mixer"
  | "t1" | "t2" | "t3" | "t4"
  | "s1" | "s2" | "s3" | "s4" | "s5" | "s6" | "s7" | "s8" | "seq"
  | "mic" | "com"
  | "lift" | "drop" | "split" | "rec" | "play" | "stop" | "back" | "fwd" | "shift"
  | "piano" | "volume" | "blue" | "green" | "white" | "orange"
  | "power" | "usb";

/** One square key: grid position, and what's printed on it. */
export interface KeySpec {
  id: KeyId;
  col: number;
  row: number;
  /** Shown in the flat drawing and drawn on the 3D key's cap. */
  glyph: string;
  /** Small second line, as on 1 IN, 7 M1, COM. */
  sub?: string;
  /** Ink colour of the glyph, as printed on the device. */
  ink: "dark" | "blue" | "green" | "orange";
  /** Ink of the second line, when it differs. */
  subInk?: KeySpec["ink"];
  /** The record key's cap is solid orange. */
  solid?: boolean;
  name: string;
}

const k = (id: KeyId, col: number, row: number, glyph: string, name: string, ink: KeySpec["ink"] = "dark", sub?: string): KeySpec => ({
  id,
  col,
  row,
  glyph,
  name,
  ink,
  sub,
});

export const COLS = 17;
export const ROWS = 6;

export const KEYS: KeySpec[] = [
  k("help", 2, 1, "?", "help"),
  k("tempo", 3, 1, "♩", "tempo (metronome)"),
  k("mic", 16, 0, "mic", "mic / input", "orange"),
  k("com", 16, 1, "◉", "COM (album)", "dark", "COM"),

  k("synth", 0, 2, "∿", "synth", "blue"),
  k("drum", 1, 2, "◎", "drum", "green"),
  k("tape", 2, 2, "oo", "tape", "orange"),
  k("mixer", 3, 2, "ılı", "mixer"),
  k("t1", 4, 2, "1", "T1"),
  k("t2", 5, 2, "2", "T2"),
  k("t3", 6, 2, "3", "T3"),
  k("t4", 7, 2, "4", "T4"),
  { ...k("s1", 8, 2, "1", "1 / in", "dark", "IN"), subInk: "green" },
  { ...k("s2", 9, 2, "2", "2 / out", "dark", "OUT"), subInk: "green" },
  { ...k("s3", 10, 2, "3", "3 / loop", "dark", "↻"), subInk: "green" },
  { ...k("s4", 11, 2, "4", "4 / tape", "dark", "oo"), subInk: "orange" },
  { ...k("s5", 12, 2, "5", "5 / reverse", "dark", "Я"), subInk: "orange" },
  { ...k("s6", 13, 2, "6", "6", "dark", "•···"), subInk: "orange" },
  k("s7", 14, 2, "7", "7 / M1", "dark", "M1"),
  k("s8", 15, 2, "8", "8 / M2", "dark", "M2"),
  k("seq", 16, 2, "⁘", "sequencer", "blue"),

  k("lift", 0, 3, "↑", "lift", "orange", "1–4"),
  k("drop", 1, 3, "↓", "drop", "orange"),
  k("split", 2, 3, "✂", "split / join", "orange", "JOIN"),
  { ...k("rec", 0, 4, "●", "record", "orange"), solid: true },
  k("play", 1, 4, "▶", "play"),
  k("stop", 2, 4, "■", "stop"),
  k("back", 0, 5, "‹", "back"),
  k("fwd", 1, 5, "›", "forward"),
  k("shift", 2, 5, "Shift", "shift"),
];

/** Two-by-two tiles with a knob in the middle. */
export const ENCODERS: { id: KeyId; col: number; color: string; name: string }[] = [
  { id: "blue", col: 8, color: "#3a9be0", name: "blue encoder" },
  { id: "green", col: 10, color: "#22a64b", name: "green encoder" },
  { id: "white", col: 12, color: "#f2f2ef", name: "white encoder" },
  { id: "orange", col: 14, color: "#f2622a", name: "orange encoder" },
];

export const SPEAKER = { col: 0, row: 0, w: 2, h: 2 };
/** The volume tile; its knob sits towards the left of it. */
export const VOLUME = { col: 2, row: 0, w: 2, h: 1, knobCol: 2.5 };
export const SCREEN = { col: 4, row: 0, w: 4, h: 2 };

/** Fourteen white keys, F to E, each one column wide and two rows tall. */
export const WHITE_KEYS = 14;
export const KEYBOARD = { col: 3, row: 4 };
/** Black keys sit on the line after these white keys (0 = the first F). */
export const BLACK_AFTER = [0, 1, 2, 4, 5, 7, 8, 9, 11, 12];
/** The white key the drawings light up for "play a key": the middle C. */
export const LIT_KEY = 4;

/** Along the right-hand edge, millimetres from the front (the keys' side). */
export const EDGE = {
  depth: 102,
  slots: [5, 97],
  power: { at: 21, travel: 5 },
  usb: 42,
  jacks: [59, 74],
};

/** Printed-ink colours, from the photos. */
export const INK = {
  dark: "#3a3d42",
  blue: "#3a8fd9",
  green: "#1f9e4a",
  orange: "#ef6a2c",
};
