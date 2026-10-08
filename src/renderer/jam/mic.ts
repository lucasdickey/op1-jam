import { detectPitch, hzToMidi, level, type HumFrame } from "../../shared/hum";
import workletUrl from "./capture.worklet.js?url&no-inline";

// The Mac's microphone, read for pitch. The audio stays in this page: it is
// turned into readings (when, how loud, what pitch) as it arrives, and only
// the notes made from them ever leave, in the request to Claude.
//
// Every reading is stamped on the page's clock, the one the player stamps its
// MIDI with, so a hummed note can be placed against the beat. The stamp is
// the moment the sound reached the mic: the audio clock's time, less the
// time the sound took to get through the Mac's input to here.

/** Readings are taken on the mic's sound at half its rate: plenty for a voice. */
const DECIMATE = 2;
/** How much sound each reading looks at, and how often one is taken, in samples at the reduced rate. */
const WINDOW = 1024;
const HOP = 256;
/** How sure a reading has to be to count as a pitch. */
const MIN_CLARITY = 0.6;
/** The input's delay when the system doesn't report one: typical of a Mac's built-in mic. */
const DEFAULT_INPUT_MS = 12;

export class MicError extends Error {}

export class Mic {
  private ring: Float32Array = new Float32Array(WINDOW * 4);
  /** Samples (reduced rate) received so far, and the frame number of the first. */
  private count = 0;
  private origin = -1;
  /** The next reading starts at this reduced-rate sample. */
  private next = 0;
  private closed = false;

  private constructor(
    private ctx: AudioContext,
    private stream: MediaStream,
    private node: AudioWorkletNode,
    private source: MediaStreamAudioSourceNode,
    private inputMs: number,
    private onFrame: (frame: HumFrame) => void,
  ) {
    node.port.onmessage = (e: MessageEvent<{ frame: number; samples: Float32Array }>) =>
      this.take(e.data.frame, e.data.samples);
  }

  /** Ask for the mic and start reading it. Throws MicError with a line for the person. */
  static async open(onFrame: (frame: HumFrame) => void): Promise<Mic> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // Raw sound: the Mac's voice processing would smooth away the starts
        // of notes, and with headphones there is no echo to cancel.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      throw new MicError(
        name === "NotAllowedError"
          ? "The mic is blocked. Allow OP-1 Jam in System Settings → Privacy & Security → Microphone."
          : name === "NotFoundError"
            ? "No microphone found."
            : "Couldn't open the microphone.",
      );
    }
    const ctx = new AudioContext({ latencyHint: "interactive" });
    try {
      await ctx.audioWorklet.addModule(workletUrl);
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "op1-capture", { numberOfInputs: 1, numberOfOutputs: 0 });
      source.connect(node);
      if (ctx.state !== "running") await ctx.resume();
      const reported = (stream.getAudioTracks()[0]?.getSettings() as { latency?: number }).latency;
      const inputMs = typeof reported === "number" && reported > 0 ? reported * 1000 : DEFAULT_INPUT_MS;
      return new Mic(ctx, stream, node, source, inputMs, onFrame);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      throw new MicError("Couldn't start listening to the microphone.");
    }
  }

  /** Stop listening and let go of the mic, so macOS's mic light goes out. */
  close() {
    if (this.closed) return;
    this.closed = true;
    this.node.port.onmessage = null;
    this.source.disconnect();
    this.stream.getTracks().forEach((t) => t.stop());
    void this.ctx.close();
  }

  /** The page-clock moment a sample (at the audio's full rate) reached the mic. */
  private when(frame: number): number {
    const ts = this.ctx.getOutputTimestamp();
    const ctxTime = ts.contextTime ?? this.ctx.currentTime;
    const perfTime = ts.performanceTime ?? performance.now();
    // The output timestamp says when a frame is heard from the speaker; a
    // frame captured as that one was being made reached the mic before it by
    // the output's delay and the input's.
    const outMs = (this.ctx.outputLatency || this.ctx.baseLatency || 0) * 1000;
    return perfTime + (frame / this.ctx.sampleRate - ctxTime) * 1000 - outMs - this.inputMs;
  }

  private take(frame: number, samples: Float32Array) {
    if (this.closed) return;
    if (this.origin < 0) this.origin = frame;
    // Halve the rate by averaging pairs, which also cuts the hiss above a voice.
    const reduced = samples.length / DECIMATE;
    for (let i = 0; i < reduced; i++) {
      const v = (samples[i * DECIMATE] + samples[i * DECIMATE + 1]) / 2;
      this.ring[(this.count + i) % this.ring.length] = v;
    }
    this.count += reduced;

    const rate = this.ctx.sampleRate / DECIMATE;
    const buf = new Float32Array(WINDOW);
    while (this.next + WINDOW <= this.count) {
      for (let i = 0; i < WINDOW; i++) buf[i] = this.ring[(this.next + i) % this.ring.length];
      const p = detectPitch(buf, rate);
      const centre = this.origin + (this.next + WINDOW / 2) * DECIMATE;
      this.onFrame({
        time: this.when(centre),
        level: level(buf),
        midi: p && p.clarity >= MIN_CLARITY ? hzToMidi(p.hz) : null,
      });
      this.next += HOP;
    }
  }
}
