import { STEPS_PER_BAR, type LoopBars, type Pattern } from "../../shared/types";

// The loop player. It keeps time in the browser and sends notes to the OP-1
// with Web MIDI timestamps, so the timing doesn't depend on Claude, on React,
// or on how busy the page is.
//
// The method is the usual one for steady timing in a browser: a timer wakes
// every TICK_MS and hands the MIDI port every note due in the next
// LOOKAHEAD_MS, each stamped with the exact moment it should sound. The port
// sends it at that moment, whatever the page is doing. A late wake-up only
// shrinks the margin; the notes stay where they were stamped.

const TICK_MS = 25;
const LOOKAHEAD_MS = 120;
/** How much of its length a note sounds, so repeated notes re-trigger. */
const GATE = 0.9;
/** The OP-1's keys send no velocity, so neither does the page. */
const VELOCITY = 100;
/** MIDI clock runs at 24 ticks to a beat: six to a sixteenth-note step. */
const CLOCKS_PER_STEP = 24 / 4;
/** Notes the OP-1 sends back within this long of one the page sent are the page's own. */
const ECHO_MS = 40;
/** Enough step marks to place a note played a few loops ago. */
const MAX_MARKS = 1024;

/** A scheduled step: when it sounds, and where it is in which loop. */
export interface StepMark {
  time: number;
  loop: number;
  step: number;
}

interface Sounding {
  channel: number;
  note: number;
  on: number;
  off: number;
}

/** A pattern's notes keyed by start step, each with how long it may hold. */
type Prepared = Map<number, { note: number; hold: number }[]>;

export interface PlayerEvents {
  /**
   * The top of a loop, fired when it sounds rather than when it was
   * scheduled. `swapped` says a waiting pattern started here.
   */
  onLoop?: (loop: number, pattern: Pattern | null, swapped: boolean) => void;
}

export class Player {
  private output: MIDIOutput | null = null;
  private channel = 0;
  private tempo = 120;
  private clock = false;
  private idleBars: LoopBars = 2;

  private pattern: Pattern | null = null;
  private prepared: Prepared = new Map();
  private pending: Pattern | null = null;

  private stopTicker: (() => void) | null = null;
  private nextStepTime = 0;
  private step = 0;
  private loop = -1;
  private lastClock = 0;

  private sounding: Sounding[] = [];
  private sent: { note: number; time: number }[] = [];
  private marks: StepMark[] = [];
  private loopEvents: { time: number; loop: number; pattern: Pattern | null; swapped: boolean }[] = [];

  constructor(private events: PlayerEvents = {}) {}

  /* --- settings ----------------------------------------------------------- */

  setOutput(output: MIDIOutput | null) {
    if (output === this.output) return;
    this.release(performance.now());
    this.output = output;
  }

  /** 1–16, as the OP-1 shows it. */
  setChannel(channel: number) {
    this.channel = Math.min(15, Math.max(0, Math.round(channel) - 1));
  }

  setTempo(bpm: number) {
    this.tempo = Math.min(240, Math.max(40, bpm));
  }

  /** Send MIDI clock, start and stop, so the OP-1 can follow the page's tempo. */
  setClock(on: boolean) {
    this.clock = on;
  }

  /** Loop length while there is no pattern yet. */
  setIdleBars(bars: LoopBars) {
    this.idleBars = bars;
  }

  get playing(): boolean {
    return this.stopTicker !== null;
  }

  get current(): Pattern | null {
    return this.pattern;
  }

  get waiting(): Pattern | null {
    return this.pending;
  }

  /**
   * Hand the player a new pattern. Stopped, it replaces the old one at once;
   * playing, it waits for the top of the loop — or the next bar line, if
   * nothing is playing yet — so the change lands on the beat.
   */
  load(pattern: Pattern) {
    if (!this.playing) {
      this.use(pattern);
      this.pending = null;
    } else {
      this.pending = pattern;
    }
  }

  /** Forget the pattern, as on a fresh start. */
  clear() {
    this.pattern = null;
    this.prepared = new Map();
    this.pending = null;
  }

  /* --- transport ---------------------------------------------------------- */

  start() {
    if (this.playing || !this.output) return;
    const t0 = performance.now() + 60;
    this.nextStepTime = t0;
    this.step = 0;
    this.loop = -1;
    this.marks = [];
    // A receiver starts on the first clock after Start.
    if (this.clock) this.output.send([0xfa], t0 - 1);
    this.stopTicker = startTicker(TICK_MS, () => this.tick());
    this.tick();
  }

  stop() {
    if (!this.stopTicker) return;
    this.stopTicker();
    this.stopTicker = null;
    const now = performance.now();
    this.release(now);
    if (this.clock && this.output) this.output.send([0xfc], Math.max(now, this.lastClock + 1));
    this.marks = [];
    this.loopEvents = [];
    this.loop = -1;
    this.step = 0;
    // A pattern that arrived too late to play becomes the one shown and kept.
    if (this.pending) {
      this.use(this.pending);
      this.pending = null;
    }
  }

  /* --- where the loop is -------------------------------------------------- */

  /** The step sounding at `time`, for the playhead. */
  positionAt(time: number): StepMark | null {
    for (let i = this.marks.length - 1; i >= 0; i--) {
      if (this.marks[i].time <= time) return this.marks[i];
    }
    return null;
  }

  /** The loop number sounding now. */
  get loopNow(): number {
    return this.positionAt(performance.now())?.loop ?? this.loop;
  }

  /**
   * Which step a moment falls on: the nearest scheduled step, so a note
   * played a hair early lands on the beat it was meant for. Null when the
   * loop wasn't running then.
   */
  locate(time: number): StepMark | null {
    if (this.marks.length === 0) return null;
    const ms = this.stepMs();
    let best: StepMark | null = null;
    let gap = Infinity;
    for (const mark of this.marks) {
      const d = Math.abs(mark.time - time);
      if (d < gap) {
        gap = d;
        best = mark;
      }
    }
    return gap <= ms ? best : null;
  }

  /**
   * Three rising notes (C, E, G around middle C) on the current channel, to
   * check the OP-1 is listening before Claude is involved. Works stopped or
   * playing.
   */
  testNotes() {
    if (!this.output) return;
    const now = performance.now();
    this.sounding = this.sounding.filter((s) => s.off > now);
    [60, 64, 67].forEach((note, i) => this.play(note, now + 20 + i * 180, 160));
  }

  /** Whether the page has a note sounding at `time`, for the "out" light. */
  soundingAt(time: number): boolean {
    return this.sounding.some((s) => s.on <= time && s.off > time);
  }

  /** Whether a note coming back from the OP-1 is one the page just sent. */
  isEcho(note: number, time: number): boolean {
    return this.sent.some((s) => s.note === note && Math.abs(s.time - time) < ECHO_MS);
  }

  stepMs(): number {
    return 60000 / this.tempo / 4;
  }

  /* --- scheduling --------------------------------------------------------- */

  private tick() {
    const now = performance.now();
    const horizon = now + LOOKAHEAD_MS;
    while (this.nextStepTime < horizon) {
      // After a stall (a sleeping laptop, a background tab) don't play the
      // backlog all at once: skip to now and carry on from there.
      if (this.nextStepTime < now - LOOKAHEAD_MS) this.nextStepTime = now;
      const ms = this.stepMs();
      this.scheduleStep(this.nextStepTime, ms);
      this.nextStepTime += ms;
    }
    while (this.loopEvents.length > 0 && this.loopEvents[0].time <= now) {
      const e = this.loopEvents.shift()!;
      this.events.onLoop?.(e.loop, e.pattern, e.swapped);
    }
    this.sounding = this.sounding.filter((s) => s.off > now);
    this.sent = this.sent.filter((s) => s.time > now - 1000);
    if (this.marks.length > MAX_MARKS) this.marks.splice(0, this.marks.length - MAX_MARKS);
  }

  private scheduleStep(t: number, ms: number) {
    const silent = !this.pattern || this.pattern.notes.length === 0;
    const swap =
      this.pending !== null &&
      (this.step === 0 || (silent && this.step % STEPS_PER_BAR === 0));
    if (swap && this.pending) {
      this.use(this.pending);
      this.pending = null;
      this.step = 0;
    }

    if (this.step === 0) {
      this.loop += 1;
      this.loopEvents.push({ time: t, loop: this.loop, pattern: this.pattern, swapped: swap });
    }

    this.marks.push({ time: t, loop: this.loop, step: this.step });

    for (const n of this.prepared.get(this.step) ?? []) {
      this.play(n.note, t, Math.max(10, n.hold * ms * GATE));
    }

    if (this.clock && this.output) {
      for (let i = 0; i < CLOCKS_PER_STEP; i++) {
        this.lastClock = t + (i * ms) / CLOCKS_PER_STEP;
        this.output.send([0xf8], this.lastClock);
      }
    }

    this.step += 1;
    if (this.step >= this.loopSteps()) this.step = 0;
  }

  private play(note: number, t: number, duration: number) {
    if (!this.output) return;
    const ch = this.channel;
    this.output.send([0x90 | ch, note, VELOCITY], t);
    this.output.send([0x80 | ch, note, 0], t + duration);
    this.sounding.push({ channel: ch, note, on: t, off: t + duration });
    this.sent.push({ note, time: t });
  }

  /**
   * Silence everything already handed to the port. A note-on stamped for the
   * next few milliseconds can't be taken back, so its note-off goes out just
   * after it rather than now.
   */
  private release(now: number) {
    if (!this.output) return;
    for (const s of this.sounding) {
      if (s.off > now) this.output.send([0x80 | s.channel, s.note, 0], Math.max(now, s.on + 1));
    }
    this.sounding = [];
  }

  private loopSteps(): number {
    return (this.pattern?.bars ?? this.idleBars) * STEPS_PER_BAR;
  }

  /**
   * Index the pattern by start step, and cut each note short of the next
   * note on the same key, so one note's release never lands on the next
   * one's start and silences it.
   */
  private use(pattern: Pattern) {
    const total = pattern.bars * STEPS_PER_BAR;
    const prepared: Prepared = new Map();
    for (const n of pattern.notes) {
      let gap = total;
      for (const m of pattern.notes) {
        if (m === n || m.note !== n.note) continue;
        const ahead = (m.step - n.step + total) % total;
        if (ahead > 0 && ahead < gap) gap = ahead;
      }
      const list = prepared.get(n.step) ?? [];
      list.push({ note: n.note, hold: Math.min(n.length, gap) });
      prepared.set(n.step, list);
    }
    this.pattern = pattern;
    this.prepared = prepared;
  }
}

/**
 * Call `fn` every `ms`, from a worker. Chrome slows a background tab's timers
 * to once a second, which would leave gaps in the loop whenever the page
 * isn't in front; a worker's timers keep their pace, so the beat comes from
 * one and the page only answers it. Falls back to a plain interval where a
 * worker can't be made.
 */
function startTicker(ms: number, fn: () => void): () => void {
  try {
    const url = URL.createObjectURL(
      new Blob([`setInterval(() => postMessage(0), ${ms});`], { type: "text/javascript" }),
    );
    const worker = new Worker(url);
    worker.onmessage = fn;
    return () => {
      worker.terminate();
      URL.revokeObjectURL(url);
    };
  } catch {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }
}
