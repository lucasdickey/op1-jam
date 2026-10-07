// Draws build/icon.png, the app icon electron-builder turns into the Mac
// .icns. Run with `npm run icon`.

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sharp = createRequire(import.meta.url)("sharp");

// macOS icons sit in a 824px rounded square inside a 1024px canvas.
const bars = [
  [0, 1, 3, "#2f6fea"],
  [3, 3, 2, "#12a364"],
  [5, 0, 2, "#eceae4"],
  [7, 2, 3, "#ff5a1f"],
  [10, 4, 2, "#2f6fea"],
  [12, 1, 2, "#12a364"],
];
const screen = { x: 222, y: 250, w: 580, h: 330 };
const col = screen.w / 14;
const row = (screen.h - 60) / 5;
const barRects = bars
  .map(([at, lane, len, colour]) =>
    `<rect x="${screen.x + 30 + at * col * 0.95}" y="${screen.y + 30 + lane * row + row * 0.2}" width="${len * col * 0.95 - 8}" height="${row * 0.6}" rx="8" fill="${colour}"/>`,
  )
  .join("");
const dots = ["#2f6fea", "#12a364", "#eceae4", "#ff5a1f"]
  .map((c, i) => `<circle cx="${302 + i * 140}" cy="700" r="44" fill="${c}" stroke="#1c1e21" stroke-opacity=".18" stroke-width="4"/>`)
  .join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f1f2f4"/>
      <stop offset="1" stop-color="#c7cad0"/>
    </linearGradient>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#metal)"/>
  <rect x="100.5" y="100.5" width="823" height="823" rx="185" fill="none" stroke="#000" stroke-opacity=".12" stroke-width="3"/>
  <rect x="${screen.x}" y="${screen.y}" width="${screen.w}" height="${screen.h}" rx="34" fill="#0a0b0d"/>
  ${barRects}
  <rect x="${screen.x + 30 + 8.3 * col * 0.95}" y="${screen.y + 22}" width="6" height="${screen.h - 44}" fill="#ff5a1f"/>
  ${dots}
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(join(here, "../build/icon.png"));
console.log("wrote build/icon.png");
