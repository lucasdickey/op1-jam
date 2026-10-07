// Launches the built app (out/) with a stand-in OP-1 and a stand-in Claude,
// and drives it the way a person would. `npm run test:app` builds first.
//
// The stand-in OP-1 replaces the page's MIDI access, recording every message
// with the moment it was stamped for, so timing can be checked exactly. The
// stand-in Claude replaces the main process's handler, so no key or network
// is needed. On a Mac the key handlers are stubbed too, so the test never
// touches your Keychain; elsewhere the real encrypted storage is exercised.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
check("the bridge offers exactly its functions", bridge === "cancelPattern,clearKey,hasKey,onShowKeySetup,setKey,setPlaying,writePattern", bridge);
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

check("no page errors", problems.length === 0, problems.slice(0, 2).join(" | "));
await app.close();
rmSync(userData, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
