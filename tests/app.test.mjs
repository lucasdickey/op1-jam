// Launches the built app (out/) with a stand-in OP-1 and a stand-in Claude,
// and drives it the way a person would. `npm run test:app` builds first.
//
// The stand-in OP-1 replaces the page's MIDI access, recording every message
// with the moment it was stamped for, so timing can be checked exactly. The
// stand-in Claude replaces the main process's handler, so no key or network
// is needed. On a Mac the key handlers are stubbed too, so the test never
// touches your Keychain; elsewhere the real encrypted storage is exercised.

import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";
import electronPath from "electron";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? `  — ${extra}` : ""}`);
};
async function until(fn, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true;
    await sleep(100);
  }
  return false;
}

function fakeMidi() {
  const log = { sent: [] };
  window.__midi = log;
  const inp = { id: "in-1", name: "OP-1 Midi Device", state: "connected", connection: "open", type: "input", onmidimessage: null };
  const out = {
    id: "out-1", name: "OP-1 Midi Device", state: "connected", connection: "open", type: "output",
    send(data, ts) { log.sent.push({ d: Array.from(data), t: ts ?? performance.now() }); },
  };
  const access = { outputs: new Map([[out.id, out]]), inputs: new Map([[inp.id, inp]]), onstatechange: null, sysexEnabled: false };
  Object.defineProperty(Navigator.prototype, "requestMIDIAccess", { configurable: true, value: async () => access });
  log.key = (note) => inp.onmidimessage?.({ data: new Uint8Array([0x90, note, 100]), timeStamp: performance.now() });
  log.keyUp = (note) => inp.onmidimessage?.({ data: new Uint8Array([0x80, note, 0]), timeStamp: performance.now() });
}

// A stand-in voice for the mic: it waits for the OP-1's count-in (the accented
// clicks the app sends), then sings D4 E4 F4 A4 on the beats of the next bar,
// "da da da" style, each note three steps long.
function fakeVoice() {
  Object.defineProperty(MediaDevices.prototype, "getUserMedia", {
    configurable: true,
    value: async () => {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(ctx.createPeriodicWave([0, 0, 0, 0], [0, 1, 0.5, 0.25]));
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const dest = ctx.createMediaStreamDestination();
      osc.connect(gain).connect(dest);
      osc.start();
      const at = (perf) => ctx.currentTime + (perf - performance.now()) / 1000;
      const watch = setInterval(() => {
        const accents = window.__midi.sent.filter((m) => m.d[0] === 0x90 && m.d[1] === 84);
        if (accents.length < 2) return;
        clearInterval(watch);
        const bar = accents[1].t;
        const beat = 60000 / window.__voiceTempo;
        [62, 64, 65, 69].forEach((note, i) => {
          const on = at(bar + i * beat);
          const off = at(bar + i * beat + (beat * 3) / 4);
          osc.frequency.setValueAtTime(440 * 2 ** ((note - 69) / 12), on);
          gain.gain.setValueAtTime(0, on);
          gain.gain.linearRampToValueAtTime(0.3, on + 0.01);
          gain.gain.setValueAtTime(0.3, off - 0.01);
          gain.gain.linearRampToValueAtTime(0, off);
        });
      }, 20);
      return dest.stream;
    },
  });
}

const userData = mkdtempSync(join(tmpdir(), "op1-jam-test-"));
const app = await _electron.launch({
  executablePath: electronPath,
  args: [...(process.platform === "linux" ? ["--no-sandbox", "--password-store=basic"] : []), ROOT],
  env: { ...process.env, OP1_JAM_USER_DATA: userData },
});
const page = await app.firstWindow();
const problems = [];
page.on("pageerror", (e) => problems.push(String(e)));
await page.waitForLoadState("domcontentloaded");

/* --- the window ------------------------------------------------------------ */

check("window title", (await page.title()) === "OP-1 Jam");
check("served from the app's own scheme", page.url() === "op1://app/index.html", page.url());
const bridge = await page.evaluate(() => Object.keys(window.op1Native ?? {}).sort().join(","));
check("the bridge offers exactly its functions", bridge === "cancelPattern,clearKey,hasKey,onShowKeySetup,onToggleDebug,saveDebug,setKey,setPlaying,writePattern", bridge);
check("no Node or Electron in the page", await page.evaluate(() => typeof require === "undefined" && typeof process === "undefined"));
check("MIDI is allowed without asking", (await page.evaluate(() => navigator.permissions.query({ name: "midi" }).then((p) => p.state))) === "granted");
check("the page can't reach the internet", (await page.evaluate(() => fetch("https://example.com").then(() => "reached", () => "blocked"))) === "blocked");
check("first launch asks for a key", await until(() => page.getByRole("dialog", { name: "Connect to Claude" }).isVisible()));

await app.evaluate(({ shell }) => {
  globalThis.__opened = [];
  shell.openExternal = async (u) => globalThis.__opened.push(u);
});
await page.getByRole("link", { name: "Where to get a key" }).click();
await sleep(300);
check("links open in the default browser", JSON.stringify(await app.evaluate(() => globalThis.__opened)) === '["https://vercel.com/docs/ai-gateway"]');
check("and the window stays put", page.url() === "op1://app/index.html");
await page.getByRole("button", { name: "Not now" }).click();

/* --- getting started ------------------------------------------------------- */

await page.getByRole("button", { name: /^Step 2:/ }).click();
const op1Mode = page.getByRole("figure", { name: "On the OP-1: Put it in OP-1 mode" });
check("the OP-1 mode card draws the OP-1", await op1Mode.isVisible());
await op1Mode.getByRole("button", { name: /album/ }).click();
check("shift is held and album pressed", (await op1Mode.locator('[data-id="shift"]').getAttribute("data-state")) === "hold" && (await op1Mode.locator('[data-id="com"]').getAttribute("data-state")) === "press");
check("and the screen shows COM", (await op1Mode.locator("svg").getAttribute("data-screen")) === "com");
await op1Mode.getByRole("button", { name: /T1/ }).click();
check("then T1", (await op1Mode.locator('[data-id="t1"]').getAttribute("data-state")) === "press" && (await op1Mode.locator("svg").getAttribute("data-screen")) === "op1");
const threeD = await until(async () => (await op1Mode.getAttribute("data-3d")) === "true", 5000);
console.log(`     (the OP-1 drawn in ${threeD ? "3D" : "2D: no WebGL here"})`);
await page.getByRole("button", { name: /^Step 1:/ }).click();

/* --- the key --------------------------------------------------------------- */

if (process.platform === "darwin") {
  await app.evaluate(({ ipcMain }) => {
    let key = null;
    for (const c of ["op1:key-has", "op1:key-set", "op1:key-clear"]) ipcMain.removeHandler(c);
    ipcMain.handle("op1:key-has", () => key !== null);
    ipcMain.handle("op1:key-set", (_e, k) => { key = k; });
    ipcMain.handle("op1:key-clear", () => { key = null; });
  });
} else {
  await app.evaluate(({ safeStorage }) => safeStorage.setUsePlainTextEncryption?.(true));
}
await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.find((i) => i.label === "Claude Key…").click());
check("Claude Key… in the menu opens the dialog", await until(() => page.getByRole("dialog", { name: "Connect to Claude" }).isVisible()));
await page.getByLabel("AI Gateway key").fill("test-key-not-real");
await page.getByRole("button", { name: "Save key" }).click();
check("saving closes the dialog", await until(async () => !(await page.getByRole("dialog").isVisible())));
check("the app reports a key is set", await page.evaluate(() => window.op1Native.hasKey()));
if (process.platform !== "darwin") {
  const stored = readFileSync(join(userData, "claude-key.bin"));
  check("the stored key is encrypted", !stored.toString("latin1").includes("test-key-not-real"));
}
check("the page has no way to read the key back", await page.evaluate(() => !("getKey" in window.op1Native)));

/* --- playing --------------------------------------------------------------- */

// A stand-in Claude: two bars of bass, answered after half a second.
await app.evaluate(({ ipcMain, powerSaveBlocker }) => {
  const n = (step, note, length) => ({ step, note, length });
  globalThis.__asked = [];
  ipcMain.removeHandler("op1:pattern");
  ipcMain.handle("op1:pattern", async (_e, _id, body) => {
    globalThis.__asked.push(body);
    await new Promise((r) => setTimeout(r, 500));
    return {
      ok: true,
      response: {
        ms: 500,
        note: "A sparse D minor line.",
        pattern: { bars: 2, notes: [n(0, 38, 6), n(4, 38, 2), n(8, 45, 4), n(16, 41, 2), n(24, 43, 4)] },
      },
    };
  });
  globalThis.__awake = [];
  const start = powerSaveBlocker.start.bind(powerSaveBlocker);
  const stop = powerSaveBlocker.stop.bind(powerSaveBlocker);
  powerSaveBlocker.start = (t) => { globalThis.__awake.push(`start:${t}`); return start(t); };
  powerSaveBlocker.stop = (id) => { globalThis.__awake.push("stop"); return stop(id); };
});

await page.addInitScript(fakeMidi);
await page.addInitScript(fakeVoice);
await page.reload();
await page.waitForLoadState("domcontentloaded");
check("connects to the OP-1 without a click", await until(async () => (await page.getByLabel("Send to").inputValue()) === "out-1"));

await page.evaluate(() => { __midi.key(62); __midi.keyUp(62); });
await page.getByLabel("Tempo in beats per minute").fill("150");
await page.locator(".op-play").click();
check("Play asks Claude for the first loop", await until(async () => (await app.evaluate(() => globalThis.__asked.length)) >= 1));
const first = await app.evaluate(() => globalThis.__asked[0]);
check("with what was played on the OP-1", JSON.stringify(first.heard) === JSON.stringify([{ note: 62, step: null, loopsAgo: null, length: null }]), JSON.stringify(first.heard));
check("the loop appears on the screen", await until(async () => (await page.locator(".op-hit").count()) === 5));
await sleep(2000);
await page.locator(".op-play").click();
await sleep(400);

const sent = await page.evaluate(() => __midi.sent);
const stepMs = 60000 / 150 / 4;
const ons = sent.filter((m) => (m.d[0] & 0xf0) === 0x90 && m.d[2] > 0);
const offs = sent.filter((m) => (m.d[0] & 0xf0) === 0x80);
const t0 = ons.find((m) => m.d[1] === 38).t;
const offGrid = ons.filter((m) => {
  const r = (((m.t - t0) % stepMs) + stepMs) % stepMs;
  return Math.min(r, stepMs - r) > 0.01;
});
check(`every note lands on the sixteenth-note grid (${ons.length} notes)`, ons.length > 0 && offGrid.length === 0);
const held = new Map();
for (const e of [...ons.map((m) => ({ t: m.t, n: m.d[1], on: 1 })), ...offs.map((m) => ({ t: m.t, n: m.d[1], on: 0 }))].sort((a, b) => a.t - b.t || a.on - b.on)) {
  held.set(e.n, e.on ? (held.get(e.n) ?? 0) + 1 : 0);
}
check("no notes left sounding after Stop", [...held.values()].every((v) => v === 0));
const awake = await app.evaluate(() => globalThis.__awake);
check("Play keeps the Mac awake and Stop lets it sleep", JSON.stringify(awake) === '["start:prevent-app-suspension","stop"]', JSON.stringify(awake));

/* --- humming --------------------------------------------------------------- */

check("the mic is allowed for sound", (await page.evaluate(() => navigator.permissions.query({ name: "microphone" }).then((p) => p.state))) === "granted");
await page.getByRole("radio", { name: "Lead" }).click();
await page.getByRole("radio", { name: "1 bar" }).click();
await page.getByLabel("Tempo in beats per minute").fill("120");
await page.evaluate(() => { window.__voiceTempo = 120; __midi.sent = []; });
const askedBefore = await app.evaluate(() => globalThis.__asked.length);
await page.getByRole("button", { name: "Hum", exact: true }).click();
check("Hum counts in", await until(async () => /Count-in/.test(await page.locator(".op-status").innerText()), 4000));
check("then listens", await until(async () => /Hum now/.test(await page.locator(".op-status").innerText()), 4000));
check("and turns the hum into a loop", await until(async () => /Your hum in/.test(await page.locator(".op-status").innerText()), 8000), await page.locator(".op-status").innerText());
const status = await page.locator(".op-status").innerText();
check("the tune as sung", /D4 E4 F4 A4/.test(status), status);
check("in its key", /D minor|F major/.test(status), status);
check("the hum is on the screen", (await page.locator(".op-hit").count()) === 4);
check("and keeps looping rather than being rewritten", (await page.getByLabel("Keep changing").inputValue()) === "0");
check("Claude wasn't asked while humming", (await app.evaluate(() => globalThis.__asked.length)) === askedBefore);
await sleep(2500);
await page.locator(".op-play").click();
await sleep(300);
const humSent = await page.evaluate(() => __midi.sent);
const humOns = humSent.filter((m) => (m.d[0] & 0xf0) === 0x90 && m.d[2] > 0);
const clicks = humOns.filter((m) => m.d[1] === 84 || m.d[1] === 79);
check("eight clicks: a bar of count-in and a bar of humming", clicks.length === 8, String(clicks.length));
const humStep = 60000 / 120 / 4;
const played = humOns.filter((m) => m.d[1] !== 84 && m.d[1] !== 79);
// The take picks up mid-bar, in step with the bars it was hummed over.
const bar1 = clicks.filter((m) => m.d[1] === 84)[1]?.t ?? 0;
const where = played.map((m) => [((Math.round((m.t - bar1) / humStep) % 16) + 16) % 16, m.d[1]]);
const wantAt = { 0: 62, 4: 64, 8: 65, 12: 69 };
check("the OP-1 plays it back on the beat", where.length >= 4 && where.every(([step, note]) => wantAt[step] === note), JSON.stringify(where));
check("starting soon after the humming ends", played.length > 0 && played[0].t - (bar1 + 16 * humStep) < 16 * humStep * 0.5, played.length ? String(Math.round(played[0].t - bar1 - 16 * humStep)) + " ms" : "none");

/* --- Debug Mode ------------------------------------------------------------ */

await app.evaluate(({ shell }) => {
  globalThis.__shown = [];
  shell.showItemInFolder = (p) => globalThis.__shown.push(p);
});
const clickMenu = (label) =>
  app.evaluate(({ Menu }, label) => Menu.getApplicationMenu().items.find((i) => i.label === "View").submenu.items.find((i) => i.label === label).click(), label);
check("Debug Mode is off to start", (await page.getByRole("region", { name: "Debug" }).count()) === 0);
await clickMenu("Debug Mode");
check("View → Debug Mode shows the panel", await until(() => page.getByRole("region", { name: "Debug" }).isVisible()));
check("with the last hum take drawn", await page.getByRole("img", { name: "Pitch trace of the last take" }).isVisible());
const debugText = await page.getByRole("region", { name: "Debug" }).innerText();
check("and the state and log", /"tempo": 120/.test(debugText) && /hum-take/.test(debugText), debugText.slice(0, 200));
await page.getByLabel("Debug comment").fill("The F came out sharp");
await page.getByRole("button", { name: "Save capture" }).click();
check("Save capture writes a file and shows it in Finder", await until(async () => (await app.evaluate(() => globalThis.__shown.length)) === 1));
const files = readdirSync(join(userData, "debug"));
const capture = JSON.parse(readFileSync(join(userData, "debug", files[0]), "utf8"));
check("the capture has the comment", capture.comment === "The F came out sharp");
check("the app's version and the page's state", capture.app?.version === "0.1.0" && capture.state?.transport?.tempo === 120);
check("the log", capture.events.some((e) => e.kind === "hum-take"));
check("and the take's mic readings, to replay it", capture.takes.at(-1)?.frames.length > 100 && capture.takes.at(-1)?.outcome === "ok");
await page.reload();
await page.waitForLoadState("domcontentloaded");
check("Debug Mode stays on after a reload", await until(() => page.getByRole("region", { name: "Debug" }).isVisible()));
await clickMenu("Debug Mode");
check("and turns off again", await until(async () => (await page.getByRole("region", { name: "Debug" }).count()) === 0));

check("no page errors", problems.length === 0, problems.slice(0, 2).join(" | "));
await app.close();
// A failed run keeps its Debug Mode capture (the hum take's mic readings) for
// CI to upload, so a take that went wrong there can be replayed here.
if (fails && existsSync(join(userData, "debug"))) cpSync(join(userData, "debug"), join(ROOT, "test-results"), { recursive: true });
rmSync(userData, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
