import type { HumFrame, HumTake, RawNote } from "../../shared/hum";
import type { Part } from "../../shared/types";

// What the page remembers for Debug Mode (View → Debug Mode): a running log
// of what happened, and the last few hum takes with every mic reading. It is
// always kept — it's small and bounded — so a capture taken right after
// something odd still holds it, even if Debug Mode was off at the time.
// Nothing here leaves the Mac unless the person saves a capture and sends it.

export interface DebugEvent {
  /** performance.now() */
  t: number;
  kind: string;
  detail?: unknown;
}

/** Everything about one hum take, enough to replay it through src/shared/hum.ts. */
export interface HumDebug {
  at: string;
  part: Exclude<Part, "drums">;
  bars: number;
  tempo: number;
  context: number[];
  /** Step 0 of the hum and the end of the last bar, on the page's clock. */
  start: number;
  end: number;
  stepMs: number;
  gate: number;
  mic: { sampleRate: number; inputMs: number; outputMs: number };
  frames: HumFrame[];
  raw: RawNote[];
  take: HumTake | null;
  outcome: string;
}

const MAX_EVENTS = 400;
const MAX_TAKES = 3;

const events: DebugEvent[] = [];
const takes: HumDebug[] = [];
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version += 1;
  for (const l of listeners) l();
}

export function debugLog(kind: string, detail?: unknown) {
  events.push({ t: performance.now(), kind, detail });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  changed();
}

export function debugTake(take: HumDebug) {
  takes.push(take);
  if (takes.length > MAX_TAKES) takes.splice(0, takes.length - MAX_TAKES);
  changed();
}

export const debugStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  version: () => version,
  events: (): readonly DebugEvent[] => events,
  takes: (): readonly HumDebug[] => takes,
};

/** Numbers trimmed to what's worth reading, so a capture stays small. */
export function compactFrames(frames: HumFrame[]): [number, number, number | null][] {
  return frames.map((f) => [
    Math.round(f.time * 10) / 10,
    Math.round(f.level * 10000) / 10000,
    f.midi === null ? null : Math.round(f.midi * 100) / 100,
  ]);
}
