// A static file server for the recorder and the compositor: Chrome won't run
// the app's module scripts from file:// URLs.

import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2" };

export function serve(dir) {
  const server = http.createServer((req, res) => {
    const path = normalize(join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname)));
    if (!path.startsWith(dir) || !existsSync(path) || statSync(path).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    createReadStream(path).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}

