// What the OP-1's screen shows at each step of a card, drawn on a canvas so
// the 3D model can use it as a texture and the flat drawing as an image. Line
// art in the screen's own pale blue, like the tape screen in the photos; the
// labels are ours, placed so each sits over the key that picks it (the screen
// spans exactly T1–T4).

export type ScreenState = "reels" | "com" | "op1" | "synth" | "drum" | "tape" | "ext";

export const SCREEN_W = 512;
export const SCREEN_H = 256;

const BG = "#07090c";
const LINE = "#9fb7dc";
const TEXT = "#e9edf3";
const DIM = "#5d6878";
const ORANGE = "#ef6a2c";
const GREEN = "#2fbf62";
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

function reel(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(x, y, r * 0.22, 0, Math.PI * 2);
  g.stroke();
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
    g.beginPath();
    g.moveTo(x + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.3);
    g.lineTo(x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85);
    g.stroke();
  }
}

function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, weight = 500) {
  g.fillStyle = color;
  g.font = `${weight} ${size}px ${MONO}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(s, x, y);
}

export function drawScreen(g: CanvasRenderingContext2D, state: ScreenState) {
  const W = SCREEN_W;
  const H = SCREEN_H;
  g.fillStyle = BG;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = LINE;
  g.lineWidth = 3;
  g.lineCap = "round";
  const quarter = (i: number) => (W / 4) * (i + 0.5);

  switch (state) {
    case "com":
      text(g, "COM", W / 2, 62, 52, TEXT, 600);
      ["OP-1", "CTRL", "DISK", "OPT"].forEach((s, i) => {
        text(g, s, quarter(i), H - 46, 30, i === 0 ? ORANGE : LINE, i === 0 ? 700 : 500);
        g.strokeStyle = i === 0 ? ORANGE : DIM;
        g.beginPath();
        g.moveTo(quarter(i), H - 22);
        g.lineTo(quarter(i), H - 6);
        g.stroke();
      });
      break;
    case "op1":
      text(g, "OP-1", W / 2, 92, 72, TEXT, 700);
      text(g, "MIDI ch 1 · USB", W / 2, 178, 30, LINE);
      break;
    case "ext":
      text(g, "EXT", W / 2, 100, 84, TEXT, 700);
      text(g, "sync", W / 2, 188, 34, GREEN, 600);
      break;
    case "synth": {
      g.beginPath();
      for (let x = 40; x <= W - 40; x += 2) {
        const y = H * 0.42 + Math.sin((x - 40) / 22) * 46 + Math.sin((x - 40) / 7) * 6;
        if (x === 40) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      text(g, "synth · 1–8", W / 2, H - 34, 30, LINE);
      break;
    }
    case "drum":
      for (let i = 0; i < 12; i++) {
        const x = 52 + i * 37;
        const h = [70, 30, 50, 30, 70, 30, 50, 38, 70, 30, 50, 30][i];
        g.beginPath();
        g.moveTo(x, H * 0.6);
        g.lineTo(x, H * 0.6 - h);
        g.stroke();
      }
      text(g, "drum · 1–8", W / 2, H - 34, 30, LINE);
      break;
    default: {
      const r = 78;
      reel(g, W * 0.3, H * 0.52, r);
      reel(g, W * 0.7, H * 0.52, r);
      g.beginPath();
      g.moveTo(W * 0.3, H * 0.52 + r);
      g.lineTo(W * 0.7, H * 0.52 + r);
      g.stroke();
      text(g, "0:00:00", W / 2, 30, 28, TEXT);
      g.strokeStyle = state === "tape" ? ORANGE : LINE;
      g.strokeRect(16, 14, 34, 34);
      text(g, state === "tape" ? "1" : "4", 33, 32, 26, state === "tape" ? ORANGE : TEXT, 600);
    }
  }
}

/** The screen as a data URL, for the flat drawing. Cached per state. */
const urls = new Map<ScreenState, string>();
export function screenUrl(state: ScreenState): string | null {
  if (typeof document === "undefined") return null;
  const cached = urls.get(state);
  if (cached) return cached;
  const c = document.createElement("canvas");
  c.width = SCREEN_W;
  c.height = SCREEN_H;
  const g = c.getContext("2d");
  if (!g) return null;
  drawScreen(g, state);
  const url = c.toDataURL("image/png");
  urls.set(state, url);
  return url;
}
