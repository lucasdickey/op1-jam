import { useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";

// Getting started, as a short deck of cards rather than a manual: one step
// per card, a few short lines each, and the step's own button on the card
// where there is one (Connect, Test sound). The OP-1 steps follow teenage
// engineering's OP-1 guide (guides/op-1/original): COM and OP-1 mode from
// "song rendering and connectivity", sync from "tempo", recording from "tape
// mode", sounds from "synthesizer mode" and "drum mode".

/* --- remembered "hide the steps" ------------------------------------------ */

// Per-viewer convenience only, so browser storage is fine; when it's blocked
// the choice still holds for the visit.
const HIDDEN_KEY = "op1:steps-hidden";
let hidden: boolean | null = null;
const listeners = new Set<() => void>();

function getHidden(): boolean {
  if (hidden === null) {
    try {
      hidden = localStorage.getItem(HIDDEN_KEY) === "1";
    } catch {
      hidden = false;
    }
  }
  return hidden;
}

function setHidden(value: boolean) {
  hidden = value;
  try {
    if (value) localStorage.setItem(HIDDEN_KEY, "1");
    else localStorage.removeItem(HIDDEN_KEY);
  } catch {
    // Storage blocked: remembered for this visit only.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/* --- the deck ------------------------------------------------------------- */

interface Slide {
  title: string;
  optional?: boolean;
  points: ReactNode[];
}

export interface StepsProps {
  /** Inside the Mac app, which connects by itself and never asks about MIDI. */
  inApp: boolean;
  supported: boolean;
  connected: boolean;
  connecting: boolean;
  denied: boolean;
  outputName: string | null;
  onConnect: () => void;
  onTest: () => void;
}

export default function Steps({
  inApp,
  supported,
  connected,
  connecting,
  denied,
  outputName,
  onConnect,
  onTest,
}: StepsProps) {
  const isHidden = useSyncExternalStore(subscribe, getHidden, () => false);
  const [at, setAt] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);

  const slides: Slide[] = [
    {
      title: "Plug in the OP-1",
      points: [
        "Use a USB to mini-USB cable that carries data, not just charge.",
        "Switch the OP-1 on.",
        "The sound comes out of the OP-1, so plug headphones or speakers into it.",
      ],
    },
    {
      title: "Put it in OP-1 mode",
      points: [
        <>
          Press <kbd>shift</kbd> + <kbd>album</kbd>.
        </>,
        <>
          Then press <kbd>T1</kbd>.
        </>,
        <>
          Not <kbd>T3</kbd>: that’s disk mode, and the page can’t see it.
        </>,
      ],
    },
    {
      title: "Connect this page",
      points: [
        !supported ? (
          <span className="op-warn">
            This browser can’t do MIDI. Open the page in Chrome or Edge.
          </span>
        ) : connected ? (
          <span className="op-ok">✓ Connected{outputName ? ` to ${outputName}` : ""}</span>
        ) : (
          <button
            type="button"
            className="op-key op-key-blue"
            onClick={onConnect}
            disabled={connecting}
          >
            {connecting ? "Connecting…" : "Connect MIDI"}
          </button>
        ),
        denied ? (
          <span className="op-warn">
            MIDI was blocked. Allow it in the site settings, left of the address, then reload.
          </span>
        ) : inApp ? (
          "The app connects by itself once the OP-1 is plugged in."
        ) : (
          "Allow MIDI when the browser asks."
        ),
      ],
    },
    {
      title: "Check you can hear it",
      points: [
        "On the OP-1, press the blue wave key and pick a sound with 1–8.",
        <>
          <button
            type="button"
            className="op-key op-key-white"
            onClick={onTest}
            disabled={!connected}
          >
            Test sound
          </button>{" "}
          <span className="op-dim">three rising notes</span>
        </>,
        "Silent? Turn the OP-1’s volume up.",
      ],
    },
    {
      title: "Play with Claude",
      points: [
        "Pick a part below to match the sound: bass, chords, lead or arpeggio.",
        "Press ▶ Play. Claude writes a loop in a few seconds.",
        "Play along on the OP-1. Claude answers in the next loop.",
      ],
    },
    {
      title: "Drums",
      optional: true,
      points: [
        "On the OP-1, press the green drum key and pick a kit with 1–8.",
        "Choose Drums below.",
        "Tap each drum key you want Claude to use. The page learns them.",
      ],
    },
    {
      title: "Record to tape",
      optional: true,
      points: [
        <>
          Press the orange tape key, then pick a track with <kbd>T1</kbd>–<kbd>T4</kbd>.
        </>,
        <>
          <kbd>REC</kbd> + <kbd>play</kbd> to record, <kbd>stop</kbd> when done.
        </>,
        "Press “I recorded this to tape”, then pick the next part and sound.",
      ],
    },
    {
      title: "Stay in time",
      optional: true,
      points: [
        "Only if you want the OP-1’s own tape or sequencers to follow the page.",
        "Tick Send clock below.",
        "On the OP-1: tempo key, then turn the green encoder to sync.",
      ],
    },
  ];

  const last = slides.length - 1;
  const slide = slides[Math.min(at, last)];
  const go = (i: number) => setAt(Math.max(0, Math.min(last, i)));

  function onKey(e: KeyboardEvent<HTMLElement>) {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(at + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(at - 1);
    }
  }

  if (isHidden) {
    return (
      <div className="op-steps-shown-again">
        <button type="button" className="op-link" onClick={() => setHidden(false)}>
          Show the steps
        </button>
      </div>
    );
  }

  return (
    <section
      className="op-panel op-steps"
      aria-roledescription="carousel"
      aria-label="Getting started"
      onKeyDown={onKey}
    >
      <div className="op-steps-top">
        <span className="op-h2">Getting started</span>
        <button type="button" className="op-link" onClick={() => setHidden(true)}>
          Hide
        </button>
      </div>

      <p className="op-sr" aria-live="polite">
        Step {at + 1} of {slides.length}: {slide.title}
      </p>

      {/* Every card is drawn in the same spot and only the current one shows, so
          the deck is as tall as its tallest card at any width and Back and Next
          never move. The hidden cards are inert: their buttons can't be reached. */}
      <div className="op-slides">
        {slides.map((s, i) => (
          <div
            key={s.title}
            className={i === at ? "op-slide op-slide-on" : "op-slide"}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${slides.length}`}
            aria-hidden={i !== at}
            inert={i !== at}
          >
            <span className="op-slide-num" aria-hidden="true">
              {i + 1}
            </span>
            <div className="op-slide-body">
              <h2 className="op-slide-title">
                {s.title}
                {s.optional ? <span className="op-slide-tag">optional</span> : null}
              </h2>
              <ul className="op-slide-points">
                {s.points.map((p, j) => (
                  <li key={j}>{p}</li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>

      <div className="op-steps-nav">
        <button type="button" className="op-seg" onClick={() => go(at - 1)} disabled={at === 0}>
          ← Back
        </button>
        <div className="op-dots" aria-label="Steps">
          {slides.map((s, i) => (
            <button
              key={s.title}
              type="button"
              aria-current={i === at ? "step" : undefined}
              aria-label={`Step ${i + 1}: ${s.title}`}
              className="op-dot"
              data-optional={s.optional ? "true" : undefined}
              onClick={() => go(i)}
            />
          ))}
        </div>
        {at < last ? (
          <button type="button" className="op-seg op-seg-next" onClick={() => go(at + 1)}>
            Next →
          </button>
        ) : (
          <button type="button" className="op-seg op-seg-next" onClick={() => setHidden(true)}>
            Done
          </button>
        )}
      </div>

      <div className="op-help">
        <button
          type="button"
          className="op-link"
          aria-expanded={helpOpen}
          onClick={() => setHelpOpen(!helpOpen)}
        >
          {helpOpen ? "Hide the fixes" : "Something not working?"}
        </button>
        {helpOpen ? (
          <ul className="op-fixes">
            <li>
              <strong>OP-1 not in the list:</strong> check it’s in OP-1 mode (<kbd>shift</kbd> +{" "}
              <kbd>album</kbd>, <kbd>T1</kbd>), the cable carries data, and no other music app is
              using it. Reload and connect again.
            </li>
            <li>
              <strong>No sound:</strong> OP-1 volume up, Channel set to 1 (the OP-1’s default), and
              the OP-1 in OP-1 mode, not controller mode (<kbd>T2</kbd>).
            </li>
            {inApp ? null : (
              <li>
                <strong>MIDI blocked:</strong> site settings, left of the address. Allow MIDI,
                then reload.
              </li>
            )}
            <li>
              <strong>A note keeps sounding:</strong> press Stop.
            </li>
            <li>
              <strong>Red message under the screen:</strong> press Write the next loop to try again.
            </li>
          </ul>
        ) : null}
      </div>
    </section>
  );
}
