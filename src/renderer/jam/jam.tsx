import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type Ref,
} from "react";
import {
  LOOP_BARS,
  MAX_TAPE,
  noteName,
  PARTS,
  STEPS_PER_BAR,
  type HeardNote,
  type LoopBars,
  type Part,
  type Pattern,
  type PatternRequest,
  type TapeLayer,
} from "../../shared/types";
import { native } from "../../shared/native";
import { describeTake, keyName } from "../../shared/hum";
import { requestPattern } from "./ask";
import { HumError, recordHum, type HumProgress } from "./hum";
import { debugLog } from "./debug";
import DebugPanel from "./debug-panel";
import { Player, type StepMark } from "./player";
import Steps from "./steps";

// The jam's controls. Everything that has to be on time lives in Player; this
// component only shows what the player is doing, gathers what the person
// played, and asks Claude for the next loop.

type Access = "idle" | "asking" | "denied" | "ready";

interface Port {
  id: string;
  name: string;
}

/** A note the person played on the OP-1, and where in the loop it fell. */
interface Played {
  note: number;
  on: number;
  off: number | null;
  mark: StepMark | null;
}

/** Loops each pattern plays before Claude is asked for the next; 0 is never. */
const EVERY = [0, 1, 2, 4, 8] as const;

const PART_LABELS: Record<Part, string> = {
  bass: "Bass",
  chords: "Chords",
  lead: "Lead",
  arpeggio: "Arpeggio",
  drums: "Drums",
};

/** How long a note played with the loop stopped still counts. */
const LOOSE_MS = 60_000;
const MAX_PLAYED = 256;
const MAX_DRUM_KEYS = 24;

const noSubscribe = () => () => {};
const DEBUG_KEY = "op1-jam-debug";

function debugRemembered(): boolean {
  try {
    return localStorage.getItem(DEBUG_KEY) === "1";
  } catch {
    return false;
  }
}
const midiSupported = () => "requestMIDIAccess" in navigator;
/** Inside the Mac app (op1-mac), which allows MIDI without asking. */
const runningInApp = () => native() !== null;

function looksLikeOp1(name: string): boolean {
  return /op-?1/i.test(name);
}

function listPorts(ports: Iterable<MIDIPort>): Port[] {
  return Array.from(ports)
    .filter((p) => p.state === "connected")
    .map((p) => ({ id: p.id, name: p.name ?? "Unnamed port" }));
}

/** The port to select after the list changes: keep the current one, else find the OP-1. */
function pickPort(ports: Port[], current: string): string {
  if (ports.some((p) => p.id === current)) return current;
  const op1 = ports.find((p) => looksLikeOp1(p.name));
  if (op1) return op1.id;
  return current === "" ? (ports[0]?.id ?? "") : "";
}

/**
 * What the person played, for the request: notes from the last two loops
 * placed on the grid, and notes played with the loop stopped as bare pitches.
 */
function collectHeard(player: Player, played: Played[]): HeardNote[] {
  const now = performance.now();
  const loopNow = player.loopNow;
  const ms = player.stepMs();
  const timed: HeardNote[] = [];
  const loose: HeardNote[] = [];
  for (const p of played) {
    if (p.mark && player.playing) {
      const ago = loopNow - p.mark.loop;
      if (ago < 0 || ago > 2) continue;
      const length =
        p.off === null ? null : Math.min(64, Math.max(1, Math.round((p.off - p.on) / ms)));
      timed.push({ note: p.note, step: p.mark.step, loopsAgo: ago, length });
    } else if (!p.mark && now - p.on < LOOSE_MS) {
      loose.push({ note: p.note, step: null, loopsAgo: null, length: null });
    }
  }
  return [...loose.slice(-24), ...timed.slice(-96)];
}

export default function Jam() {
  const supported = useSyncExternalStore(noSubscribe, midiSupported, () => true);
  const inApp = useSyncExternalStore(noSubscribe, runningInApp, () => false);

  const [access, setAccess] = useState<Access>("idle");
  const [outputs, setOutputs] = useState<Port[]>([]);
  const [inputs, setInputs] = useState<Port[]>([]);
  const [outputId, setOutputId] = useState("");
  const [inputId, setInputId] = useState("");
  const [channel, setChannel] = useState(1);

  const [playing, setPlaying] = useState(false);
  const [tempo, setTempo] = useState(110);
  const [clock, setClock] = useState(false);

  const [part, setPart] = useState<Part>("bass");
  const [bars, setBars] = useState<LoopBars>(2);
  const [direction, setDirection] = useState("");
  const [every, setEvery] = useState<number>(2);

  const [shown, setShown] = useState<Pattern | null>(null);
  const [shownPart, setShownPart] = useState<Part>("bass");
  const [waiting, setWaiting] = useState(false);
  const [asking, setAsking] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [took, setTook] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoPaused, setAutoPaused] = useState(false);

  const [heard, setHeard] = useState<number[]>([]);
  const [drumKeys, setDrumKeys] = useState<number[]>([]);
  const [tape, setTape] = useState<TapeLayer[]>([]);
  const [humming, setHumming] = useState<HumProgress | "opening" | null>(null);
  const [debug, setDebug] = useState(debugRemembered);

  const playerRef = useRef<Player | null>(null);
  const accessRef = useRef<MIDIAccess | null>(null);
  const inputRef = useRef<MIDIInput | null>(null);
  const outputIdRef = useRef("");
  const inputIdRef = useRef("");
  const playedRef = useRef<Played[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const askingRef = useRef(false);
  /** The take in progress; aborting it puts everything back. */
  const humRef = useRef<AbortController | null>(null);
  /** Where the take's step 0 falls, for the playhead while humming. */
  const humClockRef = useRef<{ start: number; stepMs: number } | null>(null);
  const autoPausedRef = useRef(false);
  /** Loops the playing pattern has run, counting the one sounding now. */
  const sinceRef = useRef(0);
  /** The part and direction the newest pattern was written for. */
  const writtenRef = useRef<{ part: Part; direction: string } | null>(null);
  const partOf = useRef(new WeakMap<Pattern, Part>());
  const screenRef = useRef<HTMLDivElement | null>(null);
  const lightsRef = useRef<HTMLSpanElement | null>(null);
  /** When the last note arrived from the OP-1, for the "in" light. */
  const lastInRef = useRef(-Infinity);

  // The latest settings, for the callbacks the player and the MIDI port hold
  // on to between renders.
  const live = useRef({ part, bars, direction, every, tempo, channel, clock, drumKeys, tape });
  useEffect(() => {
    live.current = { part, bars, direction, every, tempo, channel, clock, drumKeys, tape };
  });

  /* --- asking Claude ------------------------------------------------------ */

  const ask = useCallback(async () => {
    const player = playerRef.current;
    if (!player) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    askingRef.current = true;
    setAsking(true);
    setError(null);

    const settings = live.current;
    const written = writtenRef.current;
    const body: PatternRequest = {
      part: settings.part,
      tempo: settings.tempo,
      bars: settings.bars,
      direction: settings.direction.slice(0, 500),
      newDirection: written
        ? written.direction !== settings.direction
        : settings.direction.trim() !== "",
      // A pattern written for another part is no use as a starting point.
      current: written?.part === settings.part ? (player.waiting ?? player.current) : null,
      heard: collectHeard(player, playedRef.current),
      drumKeys: settings.part === "drums" ? settings.drumKeys : [],
      tape: settings.tape,
    };

    debugLog("ask", {
      part: body.part,
      bars: body.bars,
      tempo: body.tempo,
      newDirection: body.newDirection,
      current: body.current?.notes.length ?? null,
      heard: body.heard.length,
      tape: body.tape.map((l) => l.part),
    });
    try {
      const data = await requestPattern(body, ctrl.signal);
      if (abortRef.current !== ctrl) return;
      debugLog("answer", { ms: data.ms, notes: data.pattern.notes.length, bars: data.pattern.bars, note: data.note });

      writtenRef.current = { part: settings.part, direction: settings.direction };
      partOf.current.set(data.pattern, settings.part);
      player.load(data.pattern);
      if (player.playing) {
        setWaiting(true);
      } else {
        setShown(data.pattern);
        setShownPart(settings.part);
        setWaiting(false);
      }
      setLine(data.note);
      setTook(data.ms);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      debugLog("ask-error", err instanceof Error ? err.message : String(err));
      setError(err instanceof Error ? err.message : String(err));
      // Don't keep asking every loop into the same failure.
      autoPausedRef.current = true;
      setAutoPaused(true);
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null;
        askingRef.current = false;
        setAsking(false);
      }
    }
  }, []);

  /* --- the player --------------------------------------------------------- */

  useEffect(() => {
    const player = new Player({
      onLoop: (loop, pattern, swapped) => {
        if (swapped) debugLog("swap", { loop, notes: pattern?.notes.length ?? null });
        if (swapped) {
          setShown(pattern);
          if (pattern) setShownPart(partOf.current.get(pattern) ?? live.current.part);
          setWaiting(false);
          sinceRef.current = 0;
        }
        sinceRef.current += 1;
        const n = live.current.every;
        if (
          n > 0 &&
          sinceRef.current >= n &&
          !autoPausedRef.current &&
          !askingRef.current &&
          !humRef.current &&
          !player.waiting
        ) {
          void ask();
        }
      },
    });
    const settings = live.current;
    player.setTempo(settings.tempo);
    player.setChannel(settings.channel);
    player.setClock(settings.clock);
    player.setIdleBars(settings.bars);
    playerRef.current = player;
    // Closing the tab mid-note would leave the OP-1 holding it; stopping
    // sends the note-offs on the way out.
    const release = () => player.stop();
    window.addEventListener("pagehide", release);
    return () => {
      window.removeEventListener("pagehide", release);
      humRef.current?.abort();
      player.stop();
      playerRef.current = null;
    };
  }, [ask]);

  // The "out" and "in" lights: lit while the page has a note sounding, and
  // briefly after a note arrives from the OP-1. Set by attribute each frame
  // rather than by state, like the playhead below.
  useEffect(() => {
    const el = lightsRef.current;
    if (access !== "ready" || !el) return;
    let raf = 0;
    const frame = () => {
      const now = performance.now();
      const out = String(playerRef.current?.soundingAt(now) ?? false);
      const inn = String(now - lastInRef.current < 150);
      if (el.dataset.out !== out) el.dataset.out = out;
      if (el.dataset.in !== inn) el.dataset.in = inn;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [access]);

  // The playhead moves by a CSS variable rather than by re-rendering.
  useEffect(() => {
    const el = screenRef.current;
    if (!playing || !el) return;
    let raf = 0;
    const frame = () => {
      const now = performance.now();
      const hum = humClockRef.current;
      const mark = playerRef.current?.positionAt(now);
      const step = hum
        ? now >= hum.start
          ? Math.floor((now - hum.start) / hum.stepMs)
          : -1
        : (mark?.step ?? -1);
      el.style.setProperty("--playhead", String(step));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      el.style.setProperty("--playhead", "-1");
    };
  }, [playing]);

  /* --- MIDI in ------------------------------------------------------------ */

  const onMessage = useCallback((e: MIDIMessageEvent) => {
    const data = e.data;
    if (!data || data.length < 3) return;
    const type = data[0] & 0xf0;
    const note = data[1];
    const velocity = data[2];
    const now = performance.now();
    // The event's stamp shares performance.now()'s clock; distrust one that's far off.
    const t = Math.abs(e.timeStamp - now) < 5000 ? e.timeStamp : now;
    const player = playerRef.current;

    if (type === 0x90 && velocity > 0) {
      if (player?.isEcho(note, t)) return;
      lastInRef.current = performance.now();
      const mark = player?.playing ? player.locate(t) : null;
      debugLog("key", { note: noteName(note), step: mark?.step ?? null, loop: mark?.loop ?? null });
      const played = playedRef.current;
      played.push({ note, on: t, off: null, mark });
      if (played.length > MAX_PLAYED) played.splice(0, played.length - MAX_PLAYED);
      setHeard((h) => [...h, note].slice(-16));
      if (live.current.part === "drums") {
        setDrumKeys((keys) =>
          keys.includes(note) || keys.length >= MAX_DRUM_KEYS
            ? keys
            : [...keys, note].sort((a, b) => a - b),
        );
      }
    } else if (type === 0x80 || (type === 0x90 && velocity === 0)) {
      const played = playedRef.current;
      for (let i = played.length - 1; i >= 0; i--) {
        if (played[i].note === note && played[i].off === null) {
          played[i].off = t;
          break;
        }
      }
    }
  }, []);

  /* --- ports -------------------------------------------------------------- */

  function forgetTiming() {
    playedRef.current = playedRef.current.map((p) => ({ ...p, mark: null }));
  }

  function stopPlaying() {
    const player = playerRef.current;
    if (!player) return;
    debugLog("stop");
    humRef.current?.abort();
    player.stop();
    native()?.setPlaying(false);
    forgetTiming();
    setPlaying(false);
    setWaiting(false);
    const current = player.current;
    setShown(current);
    if (current) setShownPart(partOf.current.get(current) ?? live.current.part);
  }

  function startPlaying() {
    const player = playerRef.current;
    if (!player || !outputIdRef.current) return;
    forgetTiming();
    sinceRef.current = 0;
    debugLog("play", { tempo: live.current.tempo, clock: live.current.clock });
    player.start();
    if (!player.playing) return;
    native()?.setPlaying(true);
    setPlaying(true);
    if (!player.current && !askingRef.current) {
      autoPausedRef.current = false;
      setAutoPaused(false);
      void ask();
    }
  }

  function chooseOutput(id: string) {
    const port = id ? (accessRef.current?.outputs.get(id) ?? null) : null;
    debugLog("output", port?.name ?? null);
    outputIdRef.current = port ? id : "";
    setOutputId(port ? id : "");
    if (!port && playerRef.current?.playing) stopPlaying();
    playerRef.current?.setOutput(port);
  }

  function chooseInput(id: string) {
    if (inputRef.current) inputRef.current.onmidimessage = null;
    const port = id ? (accessRef.current?.inputs.get(id) ?? null) : null;
    debugLog("input", port?.name ?? null);
    inputRef.current = port;
    if (port) port.onmidimessage = onMessage;
    inputIdRef.current = port ? id : "";
    setInputId(port ? id : "");
  }

  function refreshPorts() {
    const midi = accessRef.current;
    if (!midi) return;
    const outs = listPorts(midi.outputs.values());
    const ins = listPorts(midi.inputs.values());
    setOutputs(outs);
    setInputs(ins);

    const hadOutput = outputIdRef.current !== "";
    const nextOut = pickPort(outs, outputIdRef.current);
    if (nextOut !== outputIdRef.current) {
      if (hadOutput && !outs.some((p) => p.id === outputIdRef.current)) {
        setError("The MIDI output went away. Is the OP-1 still plugged in and out of disk mode?");
      }
      chooseOutput(nextOut);
    }
    const nextIn = pickPort(ins, inputIdRef.current);
    if (nextIn !== inputIdRef.current) chooseInput(nextIn);
  }

  async function connect() {
    setAccess("asking");
    setError(null);
    try {
      const midi = await navigator.requestMIDIAccess();
      accessRef.current = midi;
      midi.onstatechange = () => refreshPorts();
      refreshPorts();
      setAccess("ready");
    } catch {
      setAccess("denied");
    }
  }

  // Inside the Mac app MIDI needs no permission prompt, so connect on launch
  // rather than waiting for a click. Deferred a tick so the first render
  // settles before the port lists arrive.
  const connectRef = useRef(connect);
  useEffect(() => {
    connectRef.current = connect;
  });
  useEffect(() => {
    if (!inApp) return;
    const id = setTimeout(() => connectRef.current(), 0);
    return () => clearTimeout(id);
  }, [inApp]);

  /* --- humming ----------------------------------------------------------- */

  /** Stop waiting on Claude: a take is about to replace whatever it writes. */
  function cancelAsk() {
    abortRef.current?.abort();
    abortRef.current = null;
    askingRef.current = false;
    setAsking(false);
  }

  async function hum() {
    const player = playerRef.current;
    if (humRef.current) {
      humRef.current.abort();
      return;
    }
    if (!player || !outputIdRef.current || part === "drums") return;
    cancelAsk();
    const ctrl = new AbortController();
    humRef.current = ctrl;
    setHumming("opening");
    setError(null);
    setWaiting(false);

    // The key comes from what's already in play, except drums, whose notes
    // are samples rather than pitches.
    const current = player.current;
    const context = [
      ...(current && partOf.current.get(current) !== "drums" ? current.notes.map((n) => n.note) : []),
      ...tape.filter((l) => l.part !== "drums").flatMap((l) => l.pattern.notes.map((n) => n.note)),
    ];
    const humPart = part;
    let started = player.playing;
    let phase = "";
    debugLog("hum", { part: humPart, bars, tempo, playing: player.playing, context: context.length });

    try {
      const take = await recordHum(player, {
        bars,
        part: humPart,
        context,
        signal: ctrl.signal,
        onProgress: (progress) => {
          if (player.playing && !started) {
            started = true;
            native()?.setPlaying(true);
            setPlaying(true);
          }
          if (progress.phase !== phase) {
            phase = progress.phase;
            debugLog(`hum-${phase}`, { start: Math.round(progress.start), stepMs: progress.stepMs });
          }
          humClockRef.current = progress.phase === "hum" ? progress : null;
          setHumming(progress);
          if (progress.take) {
            setShown(progress.take.pattern);
            setShownPart(humPart);
          }
        },
      });
      debugLog("hum-take", { key: keyName(take.key), notes: describeTake(take) });
      partOf.current.set(take.pattern, humPart);
      // Claude's next loop for this part is a variation on the hum.
      writtenRef.current = { part: humPart, direction: live.current.direction };
      // Keep the hum looping until the person asks Claude for more.
      setEvery(0);
      setLine(
        `Your hum in ${keyName(take.key)}: ${describeTake(take)}. Hum again to redo it, or put it on tape and have Claude write under it.`,
      );
      setTook(null);
    } catch (err) {
      const cancelled = err instanceof DOMException && err.name === "AbortError";
      debugLog(cancelled ? "hum-cancelled" : "hum-error", cancelled ? undefined : String(err));
      if (!cancelled) {
        setError(err instanceof HumError ? err.message : `Humming failed: ${String(err)}`);
      }
      const shownNow = player.waiting ?? player.current;
      setShown(shownNow);
      if (shownNow) setShownPart(partOf.current.get(shownNow) ?? live.current.part);
    } finally {
      if (humRef.current === ctrl) humRef.current = null;
      humClockRef.current = null;
      setHumming(null);
      if (!player.playing) {
        native()?.setPlaying(false);
        setPlaying(false);
      }
    }
  }

  /* --- controls ----------------------------------------------------------- */

  function askNow() {
    autoPausedRef.current = false;
    setAutoPaused(false);
    void ask();
  }

  function changeTempo(value: number) {
    if (!Number.isFinite(value)) return;
    const bpm = Math.min(240, Math.max(40, Math.round(value)));
    setTempo(bpm);
    playerRef.current?.setTempo(bpm);
  }

  function recordToTape() {
    if (!shown || tape.length >= MAX_TAPE) return;
    setTape([...tape, { part: shownPart, pattern: shown }]);
  }

  /* --- Debug Mode --------------------------------------------------------- */

  function showDebug(on: boolean) {
    setDebug(on);
    debugLog("debug-mode", on);
    try {
      localStorage.setItem(DEBUG_KEY, on ? "1" : "0");
    } catch {
      // Not remembered; it still works for this session.
    }
  }

  const showDebugRef = useRef(showDebug);
  useEffect(() => {
    showDebugRef.current = showDebug;
  });
  const debugRef = useRef(debug);
  useEffect(() => {
    debugRef.current = debug;
  });
  useEffect(() => native()?.onToggleDebug(() => showDebugRef.current(!debugRef.current)), []);

  /** Everything the page knows right now, for the debug panel and captures. */
  function debugState(): Record<string, unknown> {
    const player = playerRef.current;
    return {
      midi: {
        access,
        output: outputs.find((p) => p.id === outputId)?.name ?? null,
        input: inputs.find((p) => p.id === inputId)?.name ?? null,
        outputs: outputs.map((p) => p.name),
        inputs: inputs.map((p) => p.name),
        channel,
      },
      transport: { playing, tempo, clock },
      claude: { part, bars, direction, every, asking, waiting, autoPaused, line, took, error },
      screen: { part: shownPart, pattern: shown },
      player: player
        ? {
            playing: player.playing,
            loop: player.loopNow,
            stepMs: Math.round(player.stepMs() * 100) / 100,
            current: player.current,
            waiting: player.waiting,
          }
        : null,
      humming: humming === null || humming === "opening" ? humming : { phase: humming.phase, beat: humming.beat },
      heard: heard.map(noteName),
      drumKeys,
      tape: tape.map((l) => ({ part: l.part, pattern: l.pattern })),
    };
  }

  /* --- render ------------------------------------------------------------- */

  const screenNote = !outputId
    ? "Connect the OP-1 to begin."
    : asking && !shown
      ? "Claude is writing the first loop…"
      : "No loop yet. Press Play and Claude writes one.";

  return (
    <div className="op-jam">
      <Steps
        inApp={inApp}
        supported={supported}
        connected={access === "ready" && outputId !== ""}
        connecting={access === "asking"}
        denied={access === "denied"}
        outputName={outputs.find((p) => p.id === outputId)?.name ?? null}
        onConnect={connect}
        onTest={() => playerRef.current?.testNotes()}
      />

      <section className="op-panel op-connect" aria-label="MIDI connection">
        {!supported ? (
          <p className="op-warn">This browser can’t do MIDI. Open the page in Chrome or Edge.</p>
        ) : access !== "ready" ? (
          <>
            <div className="op-row">
              <button
                type="button"
                className="op-key op-key-blue"
                onClick={connect}
                disabled={access === "asking"}
              >
                {access === "asking" ? "Connecting…" : "Connect MIDI"}
              </button>
              {access === "denied" ? (
                <p className="op-warn">
                  MIDI was blocked. Allow it in the site settings, then reload.
                </p>
              ) : inApp ? null : (
                <p className="op-dim">Allow MIDI when the browser asks.</p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="op-row op-ports">
              <label className="op-field">
                <span>Send to</span>
                <select value={outputId} onChange={(e) => chooseOutput(e.target.value)}>
                  <option value="">—</option>
                  {outputs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="op-field">
                <span>Listen to</span>
                <select value={inputId} onChange={(e) => chooseInput(e.target.value)}>
                  <option value="">—</option>
                  {inputs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="op-field op-field-narrow">
                <span>Channel</span>
                <select
                  value={channel}
                  onChange={(e) => {
                    const ch = Number(e.target.value);
                    setChannel(ch);
                    playerRef.current?.setChannel(ch);
                  }}
                >
                  {Array.from({ length: 16 }, (_, i) => i + 1).map((ch) => (
                    <option key={ch} value={ch}>
                      {ch}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="op-key op-key-white"
                onClick={() => playerRef.current?.testNotes()}
                disabled={!outputId}
              >
                Test sound
              </button>
              <span className="op-lights" ref={lightsRef} aria-hidden="true">
                <span className="op-light op-light-out">out</span>
                <span className="op-light op-light-in">in</span>
              </span>
            </div>
            {outputs.length === 0 ? (
              <p className="op-warn op-hint">
                No OP-1 found. Is it on, in OP-1 mode, and plugged in with a data cable?
              </p>
            ) : null}
          </>
        )}
      </section>

      <section className="op-panel op-transport" aria-label="Transport">
        <button
          type="button"
          className="op-key op-play"
          data-on={playing}
          onClick={playing ? stopPlaying : startPlaying}
          disabled={!outputId}
        >
          {playing ? "■ Stop" : "▶ Play"}
        </button>
        <button
          type="button"
          className="op-key op-key-blue op-hum"
          data-on={humming !== null}
          onClick={hum}
          disabled={!outputId || (part === "drums" && humming === null)}
          title={part === "drums" ? "Hum a bass, chords, lead or arpeggio part" : undefined}
        >
          {humming === null
            ? "Hum"
            : humming === "opening"
              ? "Mic…"
              : humming.phase === "count"
                ? `Count ${humming.beat}`
                : "Cancel"}
        </button>
        <label className="op-field op-tempo">
          <span>Tempo</span>
          <input
            type="range"
            min={60}
            max={180}
            value={Math.min(180, Math.max(60, tempo))}
            onChange={(e) => changeTempo(Number(e.target.value))}
          />
          <input
            type="number"
            min={40}
            max={240}
            value={tempo}
            onChange={(e) => changeTempo(Number(e.target.value))}
            aria-label="Tempo in beats per minute"
          />
          <span className="op-dim">BPM</span>
        </label>
        <label className="op-check">
          <input
            type="checkbox"
            checked={clock}
            onChange={(e) => {
              setClock(e.target.checked);
              playerRef.current?.setClock(e.target.checked);
            }}
          />
          <span>Send clock</span>
        </label>
      </section>

      <Screen
        ref={screenRef}
        pattern={shown}
        part={shownPart}
        bars={bars}
        playing={playing}
        empty={screenNote}
      />
      <p className="op-status" aria-live="polite">
        {error ? (
          <span className="op-warn">{error}</span>
        ) : humming !== null ? (
          <span className="op-busy">
            {humming === "opening"
              ? "Opening the mic…"
              : humming.phase === "count"
                ? `Count-in… ${humming.beat}`
                : humming.phase === "hum"
                  ? `Hum now: bar ${humming.beat} of ${bars}. Sing “da da da” for clear notes.`
                  : "Got it."}
          </span>
        ) : asking ? (
          <span className="op-busy">Claude is writing the next loop…</span>
        ) : waiting ? (
          <span>Next loop is ready. It starts at the top of the loop.</span>
        ) : line ? (
          <span>
            “{line}”
            {took !== null ? <span className="op-dim"> · {(took / 1000).toFixed(1)} s</span> : null}
          </span>
        ) : (
          <span className="op-dim">&nbsp;</span>
        )}
      </p>

      {debug ? <DebugPanel state={debugState} onClose={() => showDebug(false)} /> : null}

      <div className="op-columns">
        <section className="op-panel" aria-label="What Claude writes">
          <h2 className="op-h2">Claude</h2>
          <div className="op-field-block">
            <span className="op-label">Part</span>
            <div className="op-segments" role="radiogroup" aria-label="Part">
              {PARTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={part === p}
                  className="op-seg"
                  data-part={p}
                  onClick={() => setPart(p)}
                >
                  {PART_LABELS[p]}
                </button>
              ))}
            </div>
          </div>
          <div className="op-field-block">
            <span className="op-label">Loop</span>
            <div className="op-segments" role="radiogroup" aria-label="Loop length">
              {LOOP_BARS.map((b) => (
                <button
                  key={b}
                  type="button"
                  role="radio"
                  aria-checked={bars === b}
                  className="op-seg"
                  onClick={() => {
                    setBars(b);
                    playerRef.current?.setIdleBars(b);
                  }}
                >
                  {b} bar{b === 1 ? "" : "s"}
                </button>
              ))}
            </div>
          </div>
          <label className="op-field-block">
            <span className="op-label">Direction</span>
            <textarea
              rows={2}
              maxLength={500}
              value={direction}
              placeholder="e.g. D minor, slow and sparse, leave room for my lead"
              onChange={(e) => setDirection(e.target.value)}
            />
          </label>
          <div className="op-row">
            <button
              type="button"
              className="op-key op-key-orange"
              onClick={askNow}
              disabled={!outputId || humming !== null}
            >
              Write the next loop
            </button>
            <label className="op-field">
              <span>Keep changing</span>
              <select
                value={every}
                onChange={(e) => {
                  setEvery(Number(e.target.value));
                  autoPausedRef.current = false;
                  setAutoPaused(false);
                }}
              >
                {EVERY.map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? "never" : n === 1 ? "every loop" : `every ${n} loops`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {autoPaused && every > 0 ? (
            <p className="op-dim">
              Keep changing is paused after an error. Write the next loop to resume.
            </p>
          ) : null}
          {part !== shownPart && shown ? (
            <p className="op-dim">
              Claude writes a new {PART_LABELS[part].toLowerCase()} part next time it’s asked.
            </p>
          ) : null}
        </section>

        <section className="op-panel" aria-label="What you played">
          <h2 className="op-h2">From the OP-1</h2>
          {heard.length > 0 ? (
            <p className="op-heard">{heard.map((n) => noteName(n)).join(" ")}</p>
          ) : (
            <p className="op-dim">
              Play the OP-1’s keys. Your notes show here, and Claude answers them.
            </p>
          )}
          {part === "drums" || drumKeys.length > 0 ? (
            <div className="op-drums">
              <p>
                <span className="op-label">Drum keys</span>{" "}
                {drumKeys.length > 0 ? (
                  drumKeys.join(" ")
                ) : (
                  <span className="op-dim">
                    none yet. With Drums selected, tap each drum key you want Claude to use.
                  </span>
                )}
              </p>
              {drumKeys.length > 0 ? (
                <button type="button" className="op-link" onClick={() => setDrumKeys([])}>
                  Forget these
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      <section className="op-panel" aria-label="On tape">
        <h2 className="op-h2">On tape</h2>
        <p className="op-dim">
          Recorded this part to tape? Press the button so Claude fits the next parts around it.
        </p>
        <div className="op-row">
          <button
            type="button"
            className="op-key op-key-green"
            onClick={recordToTape}
            disabled={!shown || shown.notes.length === 0 || tape.length >= MAX_TAPE}
          >
            I recorded this to tape
          </button>
        </div>
        {tape.length > 0 ? (
          <ol className="op-tape">
            {tape.map((layer, i) => (
              <li key={i} data-part={layer.part}>
                <span className="op-swatch" aria-hidden />
                {PART_LABELS[layer.part]} · {layer.pattern.bars} bar
                {layer.pattern.bars === 1 ? "" : "s"} · {layer.pattern.notes.length} notes
                <button
                  type="button"
                  className="op-link"
                  onClick={() => setTape(tape.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ol>
        ) : null}
      </section>
    </div>
  );
}

/* --- the screen ----------------------------------------------------------- */

function Screen({
  ref,
  pattern,
  part,
  bars,
  playing,
  empty,
}: {
  ref: Ref<HTMLDivElement>;
  pattern: Pattern | null;
  part: Part;
  bars: LoopBars;
  playing: boolean;
  empty: string;
}) {
  const steps = (pattern?.bars ?? bars) * STEPS_PER_BAR;
  const keys = pattern ? [...new Set(pattern.notes.map((n) => n.note))].sort((a, b) => b - a) : [];

  return (
    <div
      ref={ref}
      className="op-screen"
      data-part={part}
      data-playing={playing}
      style={{ "--steps": steps } as CSSProperties}
    >
      {keys.length === 0 || !pattern ? (
        <p className="op-screen-empty">{pattern ? "This loop is silent." : empty}</p>
      ) : (
        <div className="op-roll-scroll">
          <div className="op-roll">
            {keys.map((key) => (
              <div className="op-lane" key={key}>
                <span className="op-lane-name">{part === "drums" ? key : noteName(key)}</span>
                <div className="op-lane-track">
                  {pattern.notes
                    .filter((n) => n.note === key)
                    .map((n) => (
                      <span
                        key={n.step}
                        className="op-hit"
                        style={{ "--at": n.step, "--len": n.length } as CSSProperties}
                      />
                    ))}
                </div>
              </div>
            ))}
            <div className="op-playhead-track" aria-hidden>
              <div className="op-playhead" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
