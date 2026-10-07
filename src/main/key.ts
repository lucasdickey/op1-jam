import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, safeStorage } from "electron";

// The AI Gateway key, stored encrypted in the app's own folder. Electron's
// safeStorage encrypts with a key it keeps in the macOS Keychain, so the file
// is useless off this Mac and to other apps. macOS may ask once, on first
// save, whether OP-1 Jam may use its Keychain entry.
//
// The key only ever lives in this process. The page can ask whether one is
// set and replace it, but never read it back.

function keyFile(): string {
  return join(app.getPath("userData"), "claude-key.bin");
}

export function loadKey(): string | null {
  try {
    if (!existsSync(keyFile())) return null;
    const key = safeStorage.decryptString(readFileSync(keyFile())).trim();
    return key || null;
  } catch {
    return null;
  }
}

export function saveKey(key: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("The Mac's Keychain isn't available to OP-1 Jam, so the key can't be kept safely.");
  }
  writeFileSync(keyFile(), safeStorage.encryptString(key), { mode: 0o600 });
}

export function clearKey(): void {
  rmSync(keyFile(), { force: true });
}
