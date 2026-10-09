import { useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import {
  BLACK_AFTER,
  COLS,
  EDGE,
  ENCODERS,
  INK,
  KEYBOARD,
  KEYS,
  LIT_KEY,
  ROWS,
  SCREEN,
  SPEAKER,
  VOLUME,
  WHITE_KEYS,
  type KeyId,
} from "./op1-layout";
import { screenUrl, type ScreenState } from "./op1-screen";
import type { Op1Scene, View } from "./op1-3d";

// The OP-1 on the Getting started cards. A card plays a short script on it —
// which keys to hold and press, what the screen shows, where to look — one
// beat at a time, each beat a button to jump to.
//
// It's drawn in 3D (op1-3d.ts, loaded when a card first needs it) and can be
// dragged round. Without WebGL, or when the person prefers reduced motion, a
// flat drawing from the same layout stands in. Both are our own drawings,
// placed from photos of a real OP-1; none of teenage engineering's artwork.

export type { KeyId } from "./op1-layout";
export type Screen = ScreenState;

export interface Beat {
  /** What to do, shown under the drawing. */
  say: ReactNode;
  /** Keys held down through this beat. */
  hold?: KeyId[];
  /** Keys pressed (or knobs turned, or the switch slid) on this beat. */
  press?: KeyId[];
  screen?: Screen;
  /** Where the 3D camera looks: the whole top, the right-hand edge, the left keys. */
  view?: View;
  /** How long the beat lasts when stepping by itself. */
  ms?: number;
}

/* --- the flat drawing ----------------------------------------------------- */

const P = 20; // grid pitch
const U = 18.4; // a key
const M = 10; // margin round the grid
const W = COLS * P + 2 * M;
const H = ROWS * P + 2 * M;
const EDGE_W = 26; // room for the right-hand edge, drawn folded out
const gx = (c: number) => M + c * P + (P - U) / 2;
const gy = (r: number) => M + r * P + (P - U) / 2;
const span = (n: number) => n * P - (P - U);

export function Op1Drawing({ hold = [], press = [], screen = "reels" }: Omit<Beat, "say">) {
  const state = (id: KeyId) => (hold.includes(id) ? "hold" : press.includes(id) ? "press" : undefined);
  const screenImg = screenUrl(screen);
  const edgeX = W + 8;
  const ez = (mmFromFront: number) => M + ((EDGE.depth - mmFromFront) / EDGE.depth) * ROWS * P;
  const vx = M + VOLUME.knobCol * P;
  const vy = gy(0) + U / 2;

  return (
    <svg className="od" viewBox={`0 0 ${W + EDGE_W} ${H}`} aria-hidden="true" data-screen={screen}>
      <rect x={1} y={1} width={W - 2} height={H - 2} rx={8} className="od-body" />

      {/* speaker */}
      <rect x={gx(SPEAKER.col)} y={gy(SPEAKER.row)} width={span(SPEAKER.w)} height={span(SPEAKER.h)} rx={3} className="od-tile" />
      {Array.from({ length: 7 }, (_, y) =>
        Array.from({ length: 7 }, (_, x) => {
          const px = gx(0) + span(2) / 2 + (x - 3) * 4.4;
          const py = gy(0) + span(2) / 2 + (y - 3) * 4.4;
          return Math.hypot(x - 3, y - 3) <= 3.3 ? <circle key={`${x}${y}`} cx={px} cy={py} r={1.1} className="od-hole" /> : null;
        }),
      )}

      {/* volume, left of the screen */}
      <rect x={gx(VOLUME.col)} y={gy(VOLUME.row)} width={span(VOLUME.w)} height={span(1)} rx={3} className="od-tile" />
      <g className="od-knob" data-state={state("volume")} data-id="volume">
        <title>volume</title>
        <circle cx={vx} cy={vy} r={6} className="od-knob-cap" style={{ fill: "#f4f4f2" }} />
        <g className="od-knob-turn" style={{ transformOrigin: `${vx}px ${vy}px` }}>
          <line x1={vx} y1={vy} x2={vx} y2={vy - 5} className="od-knob-mark" />
        </g>
      </g>

      {/* screen, spanning T1–T4 */}
      <rect x={gx(SCREEN.col)} y={gy(SCREEN.row)} width={span(SCREEN.w)} height={span(SCREEN.h)} rx={3} className="od-tile" />
      {screenImg ? (
        <image
          href={screenImg}
          x={gx(SCREEN.col) + 2}
          y={gy(SCREEN.row) + 2}
          width={span(SCREEN.w) - 4}
          height={span(SCREEN.h) - 4}
          preserveAspectRatio="none"
        />
      ) : null}

      {ENCODERS.map((e) => {
        const x = gx(e.col) + span(2) / 2;
        const y = gy(0) + span(2) / 2;
        return (
          <g key={e.id} className="od-knob" data-state={state(e.id)} data-id={e.id}>
            <title>{e.name}</title>
            <rect x={gx(e.col)} y={gy(0)} width={span(2)} height={span(2)} rx={3} className="od-tile" />
            <circle cx={x} cy={y} r={11} className="od-well" />
            <circle cx={x} cy={y} r={7} className="od-knob-cap" style={{ fill: e.color }} />
            <g className="od-knob-turn" style={{ transformOrigin: `${x}px ${y}px` }}>
              <line x1={x} y1={y - 4.5} x2={x} y2={y + 4.5} className="od-knob-mark" />
            </g>
          </g>
        );
      })}

      {KEYS.map((k) => {
        const x = gx(k.col);
        const y = gy(k.row);
        const word = k.glyph.length > 2;
        return (
          <g key={k.id} className="od-key" data-state={state(k.id)} data-id={k.id}>
            <title>{k.name}</title>
            <rect x={x} y={y} width={U} height={U} rx={3} className="od-tile" />
            <circle cx={x + U / 2} cy={y + U / 2} r={U / 2 - 2} className={k.solid ? "od-cap od-cap-solid" : "od-cap"} />
            <text
              x={x + U / 2}
              y={y + U / 2 + (k.sub ? -2 : 0.5)}
              className={word ? "od-key-word" : "od-key-glyph"}
              style={{ fill: k.solid ? "#fff" : INK[k.ink] } as CSSProperties}
            >
              {k.glyph}
            </text>
            {k.sub ? (
              <text x={x + U / 2} y={y + U / 2 + 4.6} className="od-key-sub" style={{ fill: INK[k.subInk ?? k.ink] }}>
                {k.sub}
              </text>
            ) : null}
          </g>
        );
      })}

      {/* the keyboard: black keys on the row above fourteen white keys, F to E */}
      <g className="od-piano" data-state={state("piano")}>
        <title>keyboard</title>
        {Array.from({ length: WHITE_KEYS }, (_, i) => (
          <rect key={`t${i}`} x={gx(KEYBOARD.col + i)} y={gy(KEYBOARD.row - 1)} width={U} height={U} rx={3} className="od-tile" />
        ))}
        {Array.from({ length: WHITE_KEYS }, (_, i) => (
          <g key={i}>
            <rect x={gx(KEYBOARD.col + i)} y={gy(KEYBOARD.row)} width={U} height={span(2)} rx={3} className="od-tile" />
            <rect
              x={gx(KEYBOARD.col + i) + U / 2 - 4.5}
              y={gy(KEYBOARD.row) + 4}
              width={9}
              height={span(2) - 8}
              rx={4.5}
              className="od-pill"
              data-lit={i === LIT_KEY ? "true" : undefined}
            />
          </g>
        ))}
        {BLACK_AFTER.map((after) => (
          <circle key={after} cx={M + (KEYBOARD.col + after + 1) * P} cy={gy(KEYBOARD.row - 1) + U / 2} r={5.4} className="od-black" />
        ))}
      </g>

      {/* the right-hand edge, folded out beside it: switch, USB, line in, headphones */}
      <g className="od-edge">
        <rect x={edgeX} y={M} width={12} height={ROWS * P} rx={3} className="od-edge-body" />
        <g className="od-power" data-state={state("power")} data-id="power">
          <title>power switch</title>
          <rect x={edgeX + 3} y={ez(EDGE.power.at) - 5} width={6} height={10 + EDGE.power.travel} rx={3} className="od-power-slot" />
          <rect x={edgeX + 3.5} y={ez(EDGE.power.at) - 4.5} width={5} height={9} rx={2.5} className="od-power-nub" />
        </g>
        <g className="od-usb" data-state={state("usb")} data-id="usb">
          <title>mini USB</title>
          <rect x={edgeX + 3.5} y={ez(EDGE.usb) - 3.5} width={5} height={7} rx={1} className="od-port" />
        </g>
        {EDGE.jacks.map((j) => (
          <g key={j.id} className="od-jack-port" data-state={state(j.id)} data-id={j.id}>
            <title>{j.name}</title>
            <circle cx={edgeX + 6} cy={ez(j.at)} r={2.6} className="od-jack" style={{ stroke: j.ring }} />
          </g>
        ))}
      </g>
    </svg>
  );
}

/* --- the demo ------------------------------------------------------------- */

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

/** The 3D OP-1 in `canvas` while `on`, or null while loading or where it can't run. */
function useScene(canvas: HTMLCanvasElement | null, on: boolean): Op1Scene | null {
  const [scene, setScene] = useState<Op1Scene | null>(null);
  useEffect(() => {
    if (!on || !canvas) return;
    let made: Op1Scene | null = null;
    let live = true;
    void import("./op1-3d")
      .then(({ Op1Scene }) => {
        if (!live) return;
        made = new Op1Scene(canvas);
        setScene(made);
      })
      // No WebGL: the flat drawing stays.
      .catch(() => setScene(null));
    return () => {
      live = false;
      made?.dispose();
      setScene(null);
    };
  }, [canvas, on]);
  return scene;
}

/** The OP-1, stepping through `beats` while `active` (its card is showing). */
export function Op1Demo({ beats, active, label }: { beats: Beat[]; active: boolean; label: string }) {
  const reduce = useSyncExternalStore(subscribeReduce, getReduce, () => false);
  const [at, setAt] = useState(0);
  const [paused, setPaused] = useState(false);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const scene = useScene(canvas, active && !reduce);
  const beat = beats[Math.min(at, beats.length - 1)];

  useEffect(() => {
    scene?.setBeat({ hold: beat.hold, press: beat.press, screen: beat.screen, view: beat.view });
  }, [scene, beat]);

  useEffect(() => {
    if (!active || reduce || paused) return;
    const id = setTimeout(() => setAt((i) => (i + 1) % beats.length), beat.ms ?? 2000);
    return () => clearTimeout(id);
  }, [active, reduce, paused, at, beat.ms, beats.length]);

  return (
    <figure className="od-demo" aria-label={label} data-3d={scene ? "true" : "false"}>
      <div className="od-stage">
        <Op1Drawing hold={beat.hold} press={beat.press} screen={beat.screen} />
        {active && !reduce ? <canvas ref={setCanvas} className="od-canvas" aria-hidden="true" /> : null}
      </div>
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
        <p className="od-under">
          {reduce ? null : (
            <button type="button" className="op-link od-auto" onClick={() => setPaused(!paused)}>
              {paused ? "▶ Play the steps" : "❚❚ Pause"}
            </button>
          )}
          {scene ? <span className="op-dim">Drag to turn it</span> : null}
        </p>
      </figcaption>
    </figure>
  );
}
