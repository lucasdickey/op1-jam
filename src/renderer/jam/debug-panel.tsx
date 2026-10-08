import { useEffect, useState, useSyncExternalStore } from "react";
import { native } from "../../shared/native";
import { noteName, STEPS_PER_BAR } from "../../shared/types";
import { compactFrames, debugLog, debugStore, type HumDebug } from "./debug";

// Debug Mode's panel, inline under the status line: the page's state as it
// is now, what just happened, the last hum take drawn as a pitch trace, and a
// comment box that saves all of it to a file (View → Debug Mode, ⌘⇧D).

const SHOWN_EVENTS = 40;

export default function DebugPanel({
  state,
  onClose,
}: {
  /** The page's state right now; called on each refresh and on capture. */
  state: () => Record<string, unknown>;
  onClose: () => void;
}) {
  useSyncExternalStore(debugStore.subscribe, debugStore.version);
  const [now, setNow] = useState(() => performance.now());
  const [comment, setComment] = useState("");
  const [saved, setSaved] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // State that lives in refs (the player) doesn't re-render; poll it.
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 500);
    return () => clearInterval(id);
  }, []);

  const takes = debugStore.takes();
  const last = takes[takes.length - 1] ?? null;
  const events = debugStore.events().slice(-SHOWN_EVENTS).reverse();

  async function capture() {
    const app = native();
    if (!app) {
      setSaveError("Captures save from the app (npm run dev), not a browser.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    const t = performance.now();
    const report = {
      capturedAt: new Date().toISOString(),
      comment: comment.trim(),
      state: state(),
      // Times in milliseconds before the capture.
      events: debugStore.events().map((e) => ({ ago: Math.round(t - e.t), kind: e.kind, detail: e.detail })),
      takes: takes.map((h) => ({
        ...h,
        // Frame times relative to the take's step 0: [ms, level, midi].
        frames: compactFrames(h.frames.map((f) => ({ ...f, time: f.time - h.start }))),
        frameFormat: "[ms from step 0, level, midi]",
        raw: h.raw.map((r) => ({ start: Math.round(r.start - h.start), end: Math.round(r.end - h.start), pitch: Math.round(r.pitch * 100) / 100 })),
        start: undefined,
        end: Math.round(h.end - h.start),
      })),
    };
    try {
      const path = await app.saveDebug(JSON.stringify(report));
      debugLog("capture", { comment: report.comment, path });
      setSaved((s) => [...s, path]);
      setComment("");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="op-panel op-debug" aria-label="Debug">
      <div className="op-debug-head">
        <h2 className="op-h2">Debug</h2>
        <button type="button" className="op-link" onClick={onClose}>
          Hide (⌘⇧D)
        </button>
      </div>

      <div className="op-debug-comment">
        <textarea
          rows={2}
          value={comment}
          placeholder="What happened, or what you expected. Save captures this with the state, the log and the last hum takes."
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void capture();
          }}
          aria-label="Debug comment"
        />
        <button type="button" className="op-key op-key-white" onClick={capture} disabled={saving}>
          {saving ? "Saving…" : "Save capture"}
        </button>
      </div>
      {saveError ? <p className="op-warn">{saveError}</p> : null}
      {saved.length > 0 ? (
        <ul className="op-debug-saved">
          {saved.map((p) => (
            <li key={p}>Saved {p}</li>
          ))}
        </ul>
      ) : null}

      {last ? <TakeView take={last} /> : <p className="op-dim">No hum takes yet.</p>}

      <div className="op-debug-grid">
        <div>
          <h3 className="op-label">State</h3>
          <pre className="op-debug-pre">{JSON.stringify(state(), compactReplacer, 1)}</pre>
        </div>
        <div>
          <h3 className="op-label">Log (newest first)</h3>
          <ol className="op-debug-log">
            {events.map((e, i) => (
              <li key={`${e.t}-${i}`}>
                <span className="op-dim">{((e.t - now) / 1000).toFixed(1)}s</span> <b>{e.kind}</b>{" "}
                {e.detail === undefined ? "" : JSON.stringify(e.detail)}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/** Patterns print as "step:Name(len)" rather than a page of objects. */
function compactReplacer(key: string, value: unknown) {
  if (key === "notes" && Array.isArray(value)) {
    return value.map((n: { step: number; note: number; length: number }) => `${n.step}:${noteName(n.note)}(${n.length})`).join(" ");
  }
  return value;
}

/* --- the last take, drawn ------------------------------------------------- */

const W = 720;
const H = 160;

function TakeView({ take }: { take: HumDebug }) {
  const barMs = take.stepMs * STEPS_PER_BAR;
  const t0 = take.start - barMs;
  const t1 = take.end + 300;
  const voiced = take.frames.filter((f) => f.midi !== null && f.level >= take.gate);
  const pitches = voiced.map((f) => f.midi!);
  const lo = Math.floor(Math.min(...pitches, 60)) - 2;
  const hi = Math.ceil(Math.max(...pitches, 67)) + 2;
  const x = (t: number) => ((t - t0) / (t1 - t0)) * W;
  const y = (m: number) => H - ((m - lo) / (hi - lo)) * H;
  const steps = Math.ceil((t1 - t0) / take.stepMs);

  return (
    <div className="op-debug-take">
      <p className="op-debug-line">
        <b>Last take</b> {take.outcome} · {take.part}, {take.bars} bar{take.bars === 1 ? "" : "s"} at {take.tempo} BPM ·
        gate {take.gate.toFixed(4)} · mic {take.mic.sampleRate} Hz, in {take.mic.inputMs.toFixed(0)} ms, out{" "}
        {take.mic.outputMs.toFixed(0)} ms · {take.frames.length} readings, {voiced.length} voiced
      </p>
      <svg className="op-debug-trace" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Pitch trace of the last take">
        {Array.from({ length: steps + 1 }, (_, i) => {
          const t = t0 + i * take.stepMs;
          const beat = i % 4 === 0;
          const bar = i % STEPS_PER_BAR === 0;
          return (
            <line key={i} x1={x(t)} x2={x(t)} y1={0} y2={H} className={bar ? "op-tr-bar" : beat ? "op-tr-beat" : "op-tr-step"} />
          );
        })}
        <rect x={x(take.start)} y={0} width={x(take.end) - x(take.start)} height={H} className="op-tr-window" />
        {take.raw.map((r, i) => (
          <rect key={i} x={x(r.start)} y={y(r.pitch) - 3} width={Math.max(1, x(r.end) - x(r.start))} height={6} rx={2} className="op-tr-note" />
        ))}
        {take.frames.map((f, i) =>
          f.midi === null ? null : (
            <circle key={i} cx={x(f.time)} cy={y(f.midi)} r={1.4} className={f.level >= take.gate ? "op-tr-voiced" : "op-tr-quiet"} />
          ),
        )}
      </svg>
      <p className="op-debug-line">
        <span className="op-dim">heard:</span>{" "}
        {take.raw.map((r) => `${noteName(Math.round(r.pitch))}@${((r.start - take.start) / take.stepMs).toFixed(1)}`).join(" ") || "nothing"}
        {"  "}
        <span className="op-dim">→ loop:</span>{" "}
        {take.take?.pattern.notes.map((n) => `${n.step}:${noteName(n.note)}(${n.length})`).join(" ") || "nothing"}
      </p>
    </div>
  );
}
