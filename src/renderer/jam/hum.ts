import { STEPS_PER_BAR, type LoopBars, type Part } from "../../shared/types";
import { fitHum, noiseGate, segment, type HumFrame, type HumTake, type RawNote } from "../../shared/hum";
import { debugTake } from "./debug";
import { Mic, MicError } from "./mic";
import type { Player } from "./player";

// One hummed take: a bar of clicks on the OP-1 to count in, then the loop's
// length of humming over more clicks, then the tune on the loop's grid.
//
// The player keeps time throughout. Whatever it was playing is muted for the
// take (the clock to the OP-1 carries on, so its tape stays in step), and the
// take starts looping as soon as it's ready, in step with the bars it was
// hummed over.

export interface HumProgress {
  phase: "count" | "hum" | "done";
  /** Count-in beats left (4, 3, 2, 1), or the bar being hummed (1-based). */
  beat: number;
  /** The tune so far, while humming. */
  take: HumTake | null;
  /** When step 0 of the hum sounds, and a step's length, for the playhead. */
  start: number;
  stepMs: number;
}

export interface HumOptions {
  bars: LoopBars;
  part: Exclude<Part, "drums">;
  /** Notes already in play, to choose the key with. */
  context: number[];
  signal: AbortSignal;
  onProgress: (progress: HumProgress) => void;
}

export class HumError extends Error {}

/** How often the tune on the screen catches up with the humming. */
const REDRAW_MS = 120;
/** How long after the take's last beat to keep listening, for the mic's delay. */
const TAIL_MS = 250;

/**
 * Record a take and hand it to the player. Resolves with the take, or throws
 * HumError (no tune heard, no mic) or an AbortError. On any failure the
 * player is left as it was found.
 */
export async function recordHum(player: Player, opts: HumOptions): Promise<HumTake> {
  const frames: HumFrame[] = [];
  const mic = await Mic.open((f) => frames.push(f));
  const wasPlaying = player.playing;
  let handed = false;
  // For Debug Mode: every reading and decision, saved however the take ends.
  const record = {
    at: new Date().toISOString(),
    part: opts.part,
    bars: opts.bars,
    tempo: Math.round(60000 / (player.stepMs() * 4)),
    context: opts.context,
    start: 0,
    end: 0,
    stepMs: player.stepMs(),
    gate: 0,
    mic: mic.timing,
    frames,
    raw: [] as RawNote[],
    take: null as HumTake | null,
    outcome: "cancelled",
  };

  try {
    if (opts.signal.aborted) throw abortError();
    player.cancelPending();
    player.setMuted(true);
    // Stopped, the clicks start with the loop: that first bar is the count-in.
    if (!wasPlaying) {
      player.setClick(0, Infinity);
      player.start();
      if (!player.playing) throw new HumError("Connect the OP-1 to hum to it.");
    }
    const stepMs = player.stepMs();
    const barMs = stepMs * STEPS_PER_BAR;
    const beatMs = stepMs * 4;
    // Hum from the first bar line with a whole bar of count-in before it.
    // Stopped, that's the loop's second bar; playing, the count-in's first
    // click must still be ahead of what the player has already scheduled.
    const room = wasPlaying ? 150 : -80;
    const start = player.barAfter(performance.now() + barMs + room)!;
    const end = start + opts.bars * barMs;
    player.setClick(start - barMs, end);
    Object.assign(record, { start, end, stepMs });

    const fit = (upTo: number) => {
      const gate = noiseGate(frames.filter((f) => f.time < start - stepMs));
      const raw = segment(
        frames.filter((f) => f.time >= start - stepMs / 2 && f.time < upTo),
        gate,
      );
      Object.assign(record, { gate, raw });
      return fitHum(raw, { start, stepMs, bars: opts.bars, part: opts.part, context: opts.context });
    };

    // Count in, then hum, redrawing as it goes.
    while (performance.now() < end + TAIL_MS) {
      await wait(REDRAW_MS, opts.signal);
      const now = performance.now();
      if (now < start) {
        opts.onProgress({ phase: "count", beat: Math.max(1, Math.ceil((start - now) / beatMs)), take: null, start, stepMs });
      } else if (now < end) {
        opts.onProgress({ phase: "hum", beat: Math.floor((now - start) / barMs) + 1, take: fit(now), start, stepMs });
      }
    }

    const take = fit(end);
    record.take = take;
    if (take.pattern.notes.length === 0) {
      throw new HumError("Didn't hear a tune. Hum closer to the Mac, or sing “da da da”.");
    }
    player.loadFrom(take.pattern, start);
    handed = true;
    record.outcome = "ok";
    opts.onProgress({ phase: "done", beat: 0, take, start, stepMs });
    return take;
  } catch (err) {
    if (!(err instanceof DOMException && err.name === "AbortError")) {
      record.outcome = err instanceof Error ? err.message : String(err);
    }
    if (err instanceof MicError) throw new HumError(err.message);
    throw err;
  } finally {
    mic.close();
    debugTake({ ...record, frames: [...frames] });
    if (!handed) {
      player.setClick(Infinity, -Infinity);
      player.setMuted(false);
      if (!wasPlaying) player.stop();
    }
  }
}

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const id = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(id);
      reject(abortError());
    };
    signal.addEventListener("abort", stop, { once: true });
  });
}
