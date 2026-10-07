import { contextBridge, ipcRenderer } from "electron";
import type { Op1Native } from "../shared/native";

// The bridge between the page and the app: exactly the functions in
// lib/op1/native.ts, each one a message to the main process. The page gets
// this object as window.op1Native and nothing else of Electron or Node.

const bridge: Op1Native = {
  writePattern: (id, request) => ipcRenderer.invoke("op1:pattern", id, request),
  cancelPattern: (id) => ipcRenderer.send("op1:cancel", id),
  setPlaying: (playing) => ipcRenderer.send("op1:playing", playing),
  hasKey: () => ipcRenderer.invoke("op1:key-has"),
  setKey: (key) => ipcRenderer.invoke("op1:key-set", key),
  clearKey: () => ipcRenderer.invoke("op1:key-clear"),
  onShowKeySetup: (listener) => {
    const handler = () => listener();
    ipcRenderer.on("op1:show-key-setup", handler);
    return () => {
      ipcRenderer.removeListener("op1:show-key-setup", handler);
    };
  },
};

contextBridge.exposeInMainWorld("op1Native", bridge);
