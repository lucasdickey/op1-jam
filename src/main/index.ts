import { join, normalize, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  powerSaveBlocker,
  protocol,
  session,
  shell,
  systemPreferences,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from "electron";
import { errorLine, PatternRequestSchema, writePattern } from "./claude";
import type { NativeResult } from "../shared/native";
import { clearKey, loadKey, saveKey } from "./key";

// OP-1 Jam's main process: the one part of the app that can reach macOS and
// the network. Anything the page needs from the system comes through the
// handlers below, named in src/shared/native.ts.

/** The page is served from op1://app/, a private scheme only this app knows. */
const SCHEME = "op1";
const ORIGIN = `${SCHEME}://app`;
const RENDERER_DIR = join(__dirname, "../renderer");
/** Set by `electron-vite dev`: the page comes from Vite, with live reload. */
const DEV_URL = process.env.ELECTRON_RENDERER_URL;

/**
 * The page's security policy in the built app: its own files only, no
 * network. Claude is reached from this process, never from the window.
 * Inline styles are allowed because the page positions notes with them; the
 * blob: worker is the player's steady beat.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "worker-src blob:",
  "connect-src 'self'",
].join("; ");

// Tests run the app against a throwaway settings folder rather than yours.
if (process.env.OP1_JAM_USER_DATA) app.setPath("userData", process.env.OP1_JAM_USER_DATA);

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let win: BrowserWindow | null = null;

/** Only the app's own page may use the handlers. */
function fromApp(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? "";
  return url.startsWith(`${ORIGIN}/`) || (!!DEV_URL && url.startsWith(DEV_URL));
}

/* --- serving the page ----------------------------------------------------- */

function servePage() {
  protocol.handle(SCHEME, async (request) => {
    const { pathname } = new URL(request.url);
    const file = normalize(join(RENDERER_DIR, decodeURIComponent(pathname)));
    if (!file.startsWith(RENDERER_DIR + sep)) {
      return new Response("Not found", { status: 404 });
    }
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    headers.set("Content-Security-Policy", CSP);
    return new Response(res.body, { status: res.status, headers });
  });
}

/* --- MIDI and the mic ------------------------------------------------------ */

// The browser asks before letting a page use MIDI; the app already knows the
// page is its own, so it answers yes — to plain MIDI only, not to system-
// exclusive messages, which can rewrite a device's settings.
//
// The mic is for humming a tune, and it's macOS that asks the person, the
// first time: the page gets sound only (never the camera), and only once
// they've said yes in the system's own dialog.
function allowMidiAndMic() {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (permission === "midi") return callback(true);
    const types = "mediaTypes" in details ? (details.mediaTypes ?? []) : [];
    if (permission !== "media" || types.length === 0 || types.some((t) => t !== "audio")) {
      return callback(false);
    }
    if (process.platform !== "darwin") return callback(true);
    if (systemPreferences.getMediaAccessStatus("microphone") === "granted") return callback(true);
    void systemPreferences.askForMediaAccess("microphone").then(callback, () => callback(false));
  });
  session.defaultSession.setPermissionCheckHandler(
    (_wc, permission, _origin, details) =>
      permission === "midi" || (permission === "media" && details.mediaType === "audio"),
  );
}

/* --- Claude ---------------------------------------------------------------- */

const inflight = new Map<string, AbortController>();

ipcMain.handle("op1:pattern", async (event, id: unknown, body: unknown): Promise<NativeResult> => {
  if (!fromApp(event) || typeof id !== "string") return { ok: false, error: "Not allowed." };
  const key = loadKey();
  if (!key) {
    return { ok: false, error: "No Claude key yet. Choose Claude Key… in the OP-1 Jam menu." };
  }
  const parsed = PatternRequestSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: "That request doesn't describe a loop." };

  // The AI Gateway reads its key from here on every request.
  process.env.AI_GATEWAY_API_KEY = key;
  const ctrl = new AbortController();
  inflight.set(id, ctrl);
  const started = Date.now();
  try {
    const { pattern, note } = await writePattern(parsed.data, ctrl.signal);
    return { ok: true, response: { pattern, note, ms: Date.now() - started } };
  } catch (err) {
    return { ok: false, error: ctrl.signal.aborted ? "Cancelled." : errorLine(err) };
  } finally {
    inflight.delete(id);
  }
});

// Asking again, or stopping, cancels the call in flight rather than paying
// for an answer nobody will hear.
ipcMain.on("op1:cancel", (event, id: unknown) => {
  if (fromApp(event) && typeof id === "string") inflight.get(id)?.abort();
});

/* --- the key --------------------------------------------------------------- */

ipcMain.handle("op1:key-has", (event) => fromApp(event) && loadKey() !== null);

ipcMain.handle("op1:key-set", (event, key: unknown) => {
  if (!fromApp(event)) throw new Error("Not allowed.");
  const value = typeof key === "string" ? key.trim() : "";
  if (!value || value.length > 500) throw new Error("That doesn't look like a key.");
  saveKey(value);
});

ipcMain.handle("op1:key-clear", (event) => {
  if (fromApp(event)) clearKey();
});

/* --- staying awake while a loop plays -------------------------------------- */

// The loop stops if the Mac goes to sleep. While it plays, keep the system
// awake; the display may still dim and sleep on its own schedule.
let awake: number | null = null;

ipcMain.on("op1:playing", (event, playing: unknown) => {
  if (!fromApp(event)) return;
  if (playing === true && awake === null) {
    awake = powerSaveBlocker.start("prevent-app-suspension");
  } else if (playing !== true && awake !== null) {
    powerSaveBlocker.stop(awake);
    awake = null;
  }
});

/* --- the window and the menu ----------------------------------------------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1080,
    height: 920,
    minWidth: 420,
    minHeight: 520,
    title: "OP-1 Jam",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#121316" : "#e3e4e6",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Keep the page's timers running at full pace when the window is
      // behind others, so the beat never stumbles.
      backgroundThrottling: false,
    },
  });
  win.once("ready-to-show", () => win?.show());

  // Links open in the default browser; the window never leaves the page.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(ORIGIN) && !(DEV_URL && url.startsWith(DEV_URL))) event.preventDefault();
  });

  void win.loadURL(DEV_URL ?? `${ORIGIN}/index.html`);
  win.on("closed", () => {
    win = null;
  });
}

function buildMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Claude Key…",
          accelerator: "CmdOrCtrl+,",
          click: () => win?.webContents.send("op1:show-key-setup"),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* --- start ---------------------------------------------------------------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win?.isMinimized()) win.restore();
    win?.focus();
  });

  void app.whenReady().then(() => {
    servePage();
    allowMidiAndMic();
    buildMenu();
    createWindow();
  });

  // Closing the window ends the session: the music stops and the OP-1 is
  // free for other apps. Reopening the app starts a new one.
  app.on("window-all-closed", () => app.quit());
}
