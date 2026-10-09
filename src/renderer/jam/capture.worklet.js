// Runs on the audio thread: hands the page the mic's samples in blocks, each
// with the frame number of its first sample, so the page can tell when every
// sample was heard. Plain JavaScript, loaded by mic.ts with audioWorklet.

const BLOCK = 1024;

class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(BLOCK);
    this.n = 0;
    this.first = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    if (this.n === 0) this.first = currentFrame;
    this.buf.set(ch, this.n);
    this.n += ch.length;
    if (this.n >= BLOCK) {
      this.port.postMessage({ frame: this.first, samples: this.buf }, [this.buf.buffer]);
      this.buf = new Float32Array(BLOCK);
      this.n = 0;
    }
    return true;
  }
}

registerProcessor("op1-capture", Capture);
