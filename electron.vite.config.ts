import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

// Three builds, one config: the main process (Node: talks to macOS and to
// Claude), the preload script (the bridge), and the renderer (the page).
// The main bundle carries its own dependencies, so the packaged app ships
// without node_modules.
export default defineConfig({
  main: {
    build: { externalizeDeps: false },
  },
  preload: {},
  renderer: {
    plugins: [react()],
  },
});
