// Pass 1: records the app's real page (out/renderer, from `npm run build`)
// frame by frame. Headless Chrome, a stand-in OP-1 and a stand-in Claude, and
// Playwright's fake clock, so every frame is taken at an exact time and every
// MIDI note is stamped on the same timeline the soundtrack is drawn from.
//
//   node promo/record.mjs          frames + timeline into promo/out/
//   node promo/record.mjs --dry    the session without screenshots

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { serve } from "./serve.mjs";
import { ANSWERS, CLICKS, FPS, PLAYED, SECONDS, TEMPO } from "./session.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER = join(HERE, "..", "out", "renderer");
const OUT = join(HERE, "out");
const FOOTAGE = join(OUT, "footage");
const DRY = process.argv.includes("--dry");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const WIDTH = 1040;
const HEIGHT = Number(process.env.APP_HEIGHT ?? 1136);

// Runs in the page before the app: the stand-ins.
function standIns() {
  // The player's beat falls back from a Worker to setInterval, which the fake
  // clock drives.
  window.Worker = undefined;
  try { localStorage.setItem("op1:steps-hidden", "1"); } catch {}

  const midi = { sent: [] };
  window.__midi = midi;
  const inp = { id: "in-1", name: "OP-1 Midi Device", state: "connected", connection: "open", type: "input", onmidimessage: null };
  const out = {
    id: "out-1", name: "OP-1 Midi Device", state: "connected", connection: "open", type: "output",
    send(data, ts) { midi.sent.push({ d: Array.from(data), t: ts ?? performance.now() }); },
  };
  const access = { outputs: new Map([[out.id, out]]), inputs: new Map([[inp.id, inp]]), onstatechange: null, sysexEnabled: false };
  Object.defineProperty(Navigator.prototype, "requestMIDIAccess", { configurable: true, value: async () => access });
  midi.key = (note) => inp.onmidimessage?.({ data: new Uint8Array([0x90, note, 100]), timeStamp: performance.now() });
  midi.keyUp = (note) => inp.onmidimessage?.({ data: new Uint8Array([0x80, note, 0]), timeStamp: performance.now() });

  const claude = { pending: null, asked: [] };
  window.__claude = claude;
  claude.release = (response) => {
    const resolve = claude.pending;
    claude.pending = null;
    if (!resolve) throw new Error("Claude wasn't asked");
    resolve({ ok: true, response });
  };
  window.op1Native = {
    writePattern: (_id, request) => new Promise((resolve) => { claude.asked.push(request); claude.pending = resolve; }),
    cancelPattern: () => {},
    setPlaying: () => {},
    hasKey: async () => true,
    setKey: async () => {},
    clearKey: async () => {},
    onShowKeySetup: () => () => {},
  };
}

const SELECTORS = {
  main: ".op-main",
  connect: ".op-connect",
  lights: ".op-lights",
  test: ".op-connect .op-key-white",
  transport: ".op-transport",
  play: ".op-play",
  screen: ".op-screen",
  status: ".op-status",
  claude: 'section[aria-label="What Claude writes"]',
  write: 'section[aria-label="What Claude writes"] .op-key-orange',
  drums: '.op-seg[data-part="drums"]',
  chords: '.op-seg[data-part="chords"]',
  from: 'section[aria-label="What you played"]',
  tape: 'section[aria-label="On tape"]',
  tapeButton: 'section[aria-label="On tape"] .op-key-green',
};

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2, colorScheme: "light" });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(standIns);
await page.clock.install({ time: new Date("2026-10-07T18:00:00Z") });

const site = await serve(RENDERER);
await page.goto(`${site.url}/index.html`);
await page.waitForSelector(".op-jam");
// From here time only moves when this script says so: real time spent taking
// screenshots must not leak into the music.
await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);

/** Let React commit what the last timer or click changed. */
async function settle() {
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); }));
  }
}

// Connect (the app does it on launch) and set up the session.
for (let i = 0; i < 40; i++) {
  await page.clock.runFor(50);
  await settle();
  if ((await page.evaluate(() => document.querySelector(".op-ports select")?.value)) === "out-1") break;
}
if ((await page.evaluate(() => document.querySelector(".op-ports select")?.value)) !== "out-1") throw new Error("never connected");
await page.fill('input[aria-label="Tempo in beats per minute"]', String(TEMPO));
await page.fill("textarea", "D minor, sparse, leave room for me");
await page.locator("label.op-field", { hasText: "Keep changing" }).locator("select").selectOption("0");
await page.addStyleTag({ content: ".op-steps-shown-again{display:none}" });
await page.evaluate(() => document.activeElement?.blur());
await settle();

// The session, as timed events.
const clickSel = { test: SELECTORS.test, play: SELECTORS.play, write: SELECTORS.write, tape: SELECTORS.tapeButton, drums: SELECTORS.drums, chords: SELECTORS.chords };
const events = [
  ...CLICKS.map(([t, what]) => ({ t, run: () => page.evaluate((sel) => document.querySelector(sel).click(), clickSel[what]) })),
  ...ANSWERS.map((a) => ({ t: a.at, run: () => page.evaluate((r) => window.__claude.release(r), { pattern: a.pattern, note: a.note, ms: a.ms }) })),
  ...PLAYED.flatMap(([t, note, len]) => [
    { t, run: () => page.evaluate((n) => window.__midi.key(n), note) },
    { t: t + len - 1, run: () => page.evaluate((n) => window.__midi.keyUp(n), note) },
  ]),
].sort((a, b) => a.t - b.t);

const v0 = await page.evaluate(() => performance.now());
let now = 0;
let next = 0;
async function advanceTo(t) {
  if (t > now) await page.clock.runFor(t - now);
  now = t;
}

if (!DRY) {
  await rm(FOOTAGE, { recursive: true, force: true });
  await mkdir(FOOTAGE, { recursive: true });
}

const frames = [];
let tallest = 0;
const total = FPS * SECONDS;
for (let f = 0; f < total; f++) {
  // Whole milliseconds: the fake clock steps in them, and fractions would add up.
  const t = Math.round((f * 1000) / FPS);
  while (next < events.length && events[next].t <= t) {
    await advanceTo(events[next].t);
    await events[next].run();
    await settle();
    next++;
  }
  await advanceTo(t);
  await settle();
  const rects = await page.evaluate((sels) => {
    const out = {};
    for (const [k, s] of Object.entries(sels)) {
      const r = document.querySelector(s)?.getBoundingClientRect();
      if (r) out[k] = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    }
    out.height = document.documentElement.scrollHeight;
    return out;
  }, SELECTORS);
  tallest = Math.max(tallest, rects.height);
  frames.push(rects);
  if (!DRY) await page.screenshot({ path: join(FOOTAGE, `f${String(f).padStart(4, "0")}.jpg`), type: "jpeg", quality: 90 });
  if (f % 150 === 0) process.stdout.write(`${(t / 1000).toFixed(0)}s `);
}
console.log("");

const sent = await page.evaluate(() => window.__midi.sent);
const asked = await page.evaluate(() => window.__claude.asked.map((r) => ({ part: r.part, heard: r.heard.length, drumKeys: r.drumKeys, tape: r.tape.map((l) => l.part) })));
const timeline = {
  fps: FPS,
  seconds: SECONDS,
  viewport: { width: WIDTH, height: HEIGHT },
  midi: sent.map((m) => ({ d: m.d, t: m.t - v0 })),
  frames,
};
await writeFile(join(OUT, DRY ? "timeline-dry.json" : "timeline.json"), JSON.stringify(timeline));
console.log(`page height needed: ${tallest}px (viewport ${HEIGHT}px)`);
console.log(`notes sent: ${sent.filter((m) => (m.d[0] & 0xf0) === 0x90).length}; Claude asked ${asked.length} times:`, JSON.stringify(asked));
console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
await browser.close();
site.close();
