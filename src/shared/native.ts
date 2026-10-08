// What the app hands the page, through its preload script (src/preload).
// Outside the app — the page opened in a plain browser — there is no such
// thing and `native()` returns null.
//
// Every native feature the page uses goes through here, one function each.
// Adding another (a notification, a file save, a menu item) means adding a
// function to this interface, to src/preload/index.ts, and a handler in
// src/main/index.ts — nothing else in the page can reach the operating system.

import type { PatternRequest, PatternResponse } from "./types";

export type NativeResult = { ok: true; response: PatternResponse } | { ok: false; error: string };

export interface Op1Native {
  /** Ask Claude for the next loop from the app itself. `id` lets `cancelPattern` stop it. */
  writePattern(id: string, request: PatternRequest): Promise<NativeResult>;
  cancelPattern(id: string): void;
  /** Keep the Mac from sleeping while a loop plays. */
  setPlaying(playing: boolean): void;
  /** The AI Gateway key, kept encrypted with the Mac's Keychain. */
  hasKey(): Promise<boolean>;
  setKey(key: string): Promise<void>;
  clearKey(): Promise<void>;
  /** The app menu's "Claude Key…" item. Returns a function that stops listening. */
  onShowKeySetup(listener: () => void): () => void;
  /** View → Debug Mode. Returns a function that stops listening. */
  onToggleDebug(listener: () => void): () => void;
  /**
   * Save a Debug Mode capture (JSON) to the app's debug folder and show it in
   * Finder. Resolves with where it went.
   */
  saveDebug(report: string): Promise<string>;
}

declare global {
  interface Window {
    op1Native?: Op1Native;
  }
}

/** The Mac app's bridge, or null in a browser. */
export function native(): Op1Native | null {
  return typeof window === "undefined" ? null : (window.op1Native ?? null);
}
