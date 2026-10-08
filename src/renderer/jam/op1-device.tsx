import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

// A drawing of the original OP-1, for the Getting started cards: our own
// simplified line drawing, not teenage engineering's artwork, with the keys
// where the OP-1 guide (guides/op-1/original) and quick start sheet put them
// — volume left of the screen, T1–T4 under it, the colour encoders to its
// right, the power switch on the right-hand edge. Not to scale.
//
// A card plays a short script on it: which keys to hold and press, and what
// the screen shows, one beat at a time. It steps by itself unless the person
// prefers reduced motion; either way each beat is a button to jump to.

export type KeyId =
  | "help" | "tempo" | "synth" | "drum" | "tape" | "mixer"
  | "lift" | "drop" | "split" | "rec" | "play" | "stop" | "back" | "fwd"
  | "t1" | "t2" | "t3" | "t4" | "mic" | "com"
  | "shift" | "s1" | "s2" | "s3" | "s4" | "s5" | "s6" | "s7" | "s8" | "seq"
  | "piano" | "volume" | "blue" | "green" | "white" | "orange" | "power";

export type Screen = "reels" | "com" | "op1" | "synth" | "drum" | "tape" | "ext";

export interface Beat {
  /** What to do, shown under the drawing. */
  say: ReactNode;
  /** Keys held down through this beat. */
  hold?: KeyId[];
  /** Keys pressed (or knobs turned) on this beat. */
  press?: KeyId[];
  screen?: Screen;
  /** How long the beat lasts when stepping by itself. */
  ms?: number;
}

/* --- the layout ----------------------------------------------------------- */

const U = 30; // a key
const P = 34; // key pitch
const X0 = 14;
const Y0 = 14;
const col = (c: number) => X0 + c * P;
const row = (r: number) => Y0 + r * P;

interface KeyDef {
  id: KeyId;
  c: number;
  r: number;
  label: string;
  name: string;
  /** Small text under the glyph, as the OP-1 prints on some keys. */
  sub?: string;
}

const KEYS: KeyDef[] = [
  { id: "help", c: 2, r: 0, label: "?", name: "help" },
  { id: "tempo", c: 3, r: 0, label: "♩", name: "tempo (metronome)" },
  { id: "synth", c: 4, r: 0, label: "∿", name: "synth" },
  { id: "drum", c: 5, r: 0, label: "◉", name: "drum" },
  { id: "tape", c: 6, r: 0, label: "oo", name: "tape" },
  { id: "mixer", c: 7, r: 0, label: "ılı", name: "mixer" },

  { id: "lift", c: 0, r: 1, label: "lift", name: "lift" },
  { id: "drop", c: 1, r: 1, label: "drop", name: "drop" },
  { id: "split", c: 2, r: 1, label: "split", name: "split" },
  { id: "rec", c: 3, r: 1, label: "●", name: "record" },
  { id: "play", c: 4, r: 1, label: "▶", name: "play" },
  { id: "stop", c: 5, r: 1, label: "■", name: "stop" },
  { id: "back", c: 6, r: 1, label: "‹", name: "rewind / octave down" },
  { id: "fwd", c: 7, r: 1, label: "›", name: "forward / octave up" },
  { id: "t1", c: 9, r: 1, label: "1", name: "T1" },
  { id: "t2", c: 10, r: 1, label: "2", name: "T2" },
  { id: "t3", c: 11, r: 1, label: "3", name: "T3" },
  { id: "t4", c: 12, r: 1, label: "4", name: "T4" },
  { id: "mic", c: 13, r: 1, label: "mic", name: "mic / input" },
  { id: "com", c: 14, r: 1, label: "album", name: "album (COM with shift)", sub: "com" },

  { id: "shift", c: 0, r: 2, label: "shift", name: "shift" },
  ...(["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"] as const).map((id, i) => ({
    id,
    c: 1 + i,
    r: 2,
    label: String(i + 1),
    name: `sound ${i + 1}`,
  })),
  { id: "seq", c: 9, r: 2, label: "seq", name: "sequencer" },
];

const KNOBS: { id: KeyId; c: number; color: string; name: string }[] = [
  { id: "blue", c: 13, color: "var(--op-blue)", name: "blue encoder" },
  { id: "green", c: 14, color: "var(--op-green)", name: "green encoder" },
  { id: "white", c: 15, color: "var(--op-white)", name: "white encoder" },
  { id: "orange", c: 16, color: "var(--op-orange)", name: "orange encoder" },
];

const W = col(17) + X0 - (P - U);
const KB_Y = row(3) + 4;
const KB_H = 58;
const H = KB_Y + KB_H + Y0;
/** Room right of the body for the power switch's arrow. */
const EDGE = 20;
const SCREEN = { x: col(9), y: row(0) - 4, w: col(13) - col(9) - (P - U), h: U + 8 };
const WHITES = 15;
const KB_X = col(1);
const KB_W = col(17) - (P - U) - KB_X;
/** Black keys after these white keys in an octave: C# D#, F# G# A#. */
const BLACK_AFTER = [0, 1, 3, 4, 5];

/* --- the drawing ---------------------------------------------------------- */

function ScreenView({ screen }: { screen: Screen }) {
  const { x, y, w, h } = SCREEN;
  const cx = x + w / 2;
  const t = (i: number) => col(9 + i) + U / 2;
  let body: ReactNode;
  switch (screen) {
    case "com":
      body = (
        <>
          <text x={cx} y={y + 15} className="od-scr-title">COM</text>
          {["OP-1", "CTRL", "DISK", "OPT"].map((s, i) => (
            <text key={s} x={t(i)} y={y + h - 7} className={i === 0 ? "od-scr-pick" : "od-scr-dim"}>
              {s}
            </text>
          ))}
        </>
      );
      break;
    case "op1":
      body = (
        <>
          <text x={cx} y={y + 17} className="od-scr-title">OP-1 mode</text>
          <text x={cx} y={y + h - 7} className="od-scr-dim">MIDI ch 1 over USB</text>
        </>
      );
      break;
    case "ext":
      body = (
        <>
          <text x={cx} y={y + 17} className="od-scr-title">EXT</text>
          <text x={cx} y={y + h - 7} className="od-scr-green">sync</text>
        </>
      );
      break;
    case "synth":
    case "drum":
      body = (
        <>
          <path
            d={
              screen === "synth"
                ? `M ${x + 12} ${y + 20} q 10 -14 20 0 t 20 0 t 20 0 t 20 0 t 20 0`
                : `M ${x + 14} ${y + 22} h 10 m 6 -8 v 14 m 8 -6 h 12 m 6 -6 v 10 m 8 -4 h 14`
            }
            className="od-scr-line"
          />
          <text x={cx} y={y + h - 4} className="od-scr-dim">{screen === "synth" ? "synth · 1–8" : "drum kit · 1–8"}</text>
        </>
      );
      break;
    default: {
      const r = h / 2 - 7;
      body = (
        <>
          <circle cx={x + w * 0.3} cy={y + h / 2} r={r} className="od-scr-line" />
          <circle cx={x + w * 0.7} cy={y + h / 2} r={r} className="od-scr-line" />
          <line x1={x + w * 0.3} y1={y + h / 2 + r} x2={x + w * 0.7} y2={y + h / 2 + r} className="od-scr-line" />
          {screen === "tape" ? (
            <text x={cx} y={y + 10} className="od-scr-pick">T1</text>
          ) : null}
        </>
      );
    }
  }
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={3} className="od-screen" />
      {body}
    </g>
  );
}

export function Op1Drawing({ hold = [], press = [], screen = "reels" }: Omit<Beat, "say">) {
  const state = (id: KeyId) => (hold.includes(id) ? "hold" : press.includes(id) ? "press" : undefined);
  const piano = state("piano");
  const kbWhite = KB_W / WHITES;

  return (
    <svg className="od" viewBox={`0 0 ${W + EDGE} ${H}`} aria-hidden="true">
      <rect x={1} y={1} width={W - 2} height={H - 2} rx={10} className="od-body" />

      {/* speaker */}
      <g>
        <circle cx={X0 + (P + U) / 2 - 3} cy={row(0) + U / 2} r={U / 2 + 1} className="od-speaker" />
        {[-6, 0, 6].flatMap((dy) =>
          [-6, 0, 6].map((dx) => (
            <circle key={`${dx}${dy}`} cx={X0 + (P + U) / 2 - 3 + dx} cy={row(0) + U / 2 + dy} r={1.4} className="od-hole" />
          )),
        )}
      </g>

      {/* volume, left of the screen */}
      <g className="od-knob" data-state={state("volume")}>
        <title>volume</title>
        <circle cx={col(8) + U / 2} cy={row(0) + U / 2} r={U / 2 - 2} className="od-knob-cap od-volume" />
        <g className="od-knob-turn" style={{ transformOrigin: `${col(8) + U / 2}px ${row(0) + U / 2}px` }}>
          <line x1={col(8) + U / 2} y1={row(0) + U / 2} x2={col(8) + U / 2} y2={row(0) + 5} className="od-knob-mark" />
        </g>
      </g>

      <ScreenView screen={screen} />

      {KNOBS.map((k) => (
        <g key={k.id} className="od-knob" data-state={state(k.id)}>
          <title>{k.name}</title>
          <circle cx={col(k.c) + U / 2} cy={row(0) + U / 2} r={U / 2} style={{ fill: k.color }} className="od-knob-cap" />
          <g className="od-knob-turn" style={{ transformOrigin: `${col(k.c) + U / 2}px ${row(0) + U / 2}px` }}>
            <line x1={col(k.c) + U / 2} y1={row(0) + U / 2 - 3} x2={col(k.c) + U / 2} y2={row(0) + 4} className="od-knob-mark" />
          </g>
        </g>
      ))}

      {KEYS.map((k) => {
        const x = col(k.c);
        const y = row(k.r);
        const word = k.label.length > 3;
        return (
          <g key={k.id} className="od-key" data-state={state(k.id)} data-id={k.id}>
            <title>{k.name}</title>
            <rect x={x} y={y} width={U} height={U} rx={5} className="od-key-cap" />
            <circle cx={x + U / 2} cy={y + U / 2} r={U / 2 - 4} className="od-key-ring" />
            <text x={x + U / 2} y={y + U / 2 + (k.sub ? -1 : 0)} className={word ? "od-key-word" : "od-key-glyph"}>
              {k.label}
            </text>
            {k.sub ? (
              <text x={x + U / 2} y={y + U / 2 + 8} className="od-key-sub">
                {k.sub}
              </text>
            ) : null}
          </g>
        );
      })}

      {/* the keyboard: two and a bit octaves */}
      <g className="od-piano" data-state={piano}>
        <title>keyboard</title>
        {Array.from({ length: WHITES }, (_, i) => (
          <rect key={i} x={KB_X + i * kbWhite + 1} y={KB_Y} width={kbWhite - 2} height={KB_H} rx={4} className="od-white" data-lit={piano && i === 7 ? "true" : undefined} />
        ))}
        {Array.from({ length: WHITES - 1 }, (_, i) =>
          BLACK_AFTER.includes(i % 7) ? (
            <rect key={`b${i}`} x={KB_X + (i + 1) * kbWhite - kbWhite * 0.3} y={KB_Y} width={kbWhite * 0.6} height={KB_H * 0.58} rx={3} className="od-black" />
          ) : null,
        )}
      </g>

      {/* the power switch, on the right-hand edge */}
      <g className="od-power" data-state={state("power")}>
        <title>power switch (right-hand edge)</title>
        <rect x={W - 7} y={H * 0.36} width={6} height={22} rx={3} className="od-power-slot" />
        <rect x={W - 6} y={H * 0.36 + 2} width={4} height={9} rx={2} className="od-power-nub" />
        {state("power") ? (
          <path
            d={`M ${W + 10} ${H * 0.36 - 6} v 30 m -6 -7 l 6 7 l 6 -7`}
            className="od-power-arrow"
          />
        ) : null}
      </g>
    </svg>
  );
}

/* --- a script, played on the drawing -------------------------------------- */

const reduceQuery = () =>
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
const subscribeReduce = (fn: () => void) => {
  const q = reduceQuery();
  q?.addEventListener("change", fn);
  return () => q?.removeEventListener("change", fn);
};
const getReduce = () => reduceQuery()?.matches ?? false;

/** The drawing, stepping through `beats` while `active` (its card is showing). */
export function Op1Demo({ beats, active, label }: { beats: Beat[]; active: boolean; label: string }) {
  const reduce = useSyncExternalStore(subscribeReduce, getReduce, () => false);
  const [at, setAt] = useState(0);
  const [paused, setPaused] = useState(false);
  const beat = beats[Math.min(at, beats.length - 1)];

  useEffect(() => {
    if (!active || reduce || paused) return;
    const id = setTimeout(() => setAt((i) => (i + 1) % beats.length), beat.ms ?? 1600);
    return () => clearTimeout(id);
  }, [active, reduce, paused, at, beat.ms, beats.length]);

  return (
    <figure className="od-demo" aria-label={label}>
      <Op1Drawing hold={beat.hold} press={beat.press} screen={beat.screen} />
      <figcaption>
        <ol className="od-beats">
          {beats.map((b, i) => (
            <li key={i}>
              <button
                type="button"
                className="od-beat"
                aria-current={i === at ? "step" : undefined}
                onClick={() => {
                  setAt(i);
                  setPaused(true);
                }}
              >
                <span className="od-beat-n">{i + 1}</span> {b.say}
              </button>
            </li>
          ))}
        </ol>
        {reduce ? null : (
          <button type="button" className="op-link od-auto" onClick={() => setPaused(!paused)}>
            {paused ? "▶ Play the steps" : "❚❚ Pause"}
          </button>
        )}
      </figcaption>
    </figure>
  );
}
