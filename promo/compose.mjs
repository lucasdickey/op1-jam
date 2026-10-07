// Pass 3: the teaser itself. Renders director.html frame by frame in headless
// Chrome and streams the frames, with the soundtrack, into ffmpeg.
//
//   node promo/compose.mjs                      → promo/out/op1-jam-teaser.mp4
//   node promo/compose.mjs --stills 2,4.3,9     → promo/out/check/still-*.png

import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { serve } from "./serve.mjs";
import { CLICKS, KIT, PLAYED, SECONDS } from "./session.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const FPS = 60;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const stillsArg = process.argv.indexOf("--stills");
const stills = stillsArg > 0 ? process.argv[stillsArg + 1].split(",").map(Number) : null;

// What the director needs from the recording.
const timeline = JSON.parse(readFileSync(join(OUT, "timeline.json"), "utf8"));
const RECTS = { test: "test", play: "play", write: "write", tape: "tapeButton", drums: "drums", chords: "chords" };
const notesOn = timeline.midi.filter((m) => (m.d[0] & 0xf0) === 0x90 && m.d[2] > 0);
const kicks = [4.0, 14.5, 28.0];
for (let t = 16.0; t < 28.0; t += 0.5) kicks.push(t);
writeFileSync(
  join(OUT, "data.json"),
  JSON.stringify({
    fps: timeline.fps,
    viewport: timeline.viewport,
    rects: timeline.frames,
    clicks: CLICKS.map(([t, what]) => ({ t: t / 1000, name: RECTS[what] })),
    played: PLAYED.map(([t, note, len]) => ({ t: t / 1000, note, len: len / 1000, drum: t >= 14000 && t < 15500 })),
    kicks: kicks.sort((a, b) => a - b),
    bassOn: notesOn.filter((m) => m.t >= 4000 && m.t < 16000).map((m) => m.t / 1000),
    kit: KIT,
  }),
);
copyFileSync(join(HERE, "..", "build", "icon.png"), join(OUT, "icon.png"));

const site = await serve(HERE);
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(`${site.url}/director.html`);
await page.waitForFunction(() => window.ready === true);

if (stills) {
  mkdirSync(join(OUT, "check"), { recursive: true });
  for (const s of stills) {
    // Step up to the moment so stateful pieces (captions) are as they'd be.
    const f = Math.round(s * FPS);
    for (let g = Math.max(0, f - 40); g <= f; g++) await page.evaluate((x) => window.renderFrame(x), g);
    await page.screenshot({ path: join(OUT, "check", `still-${s.toFixed(2)}.png`) });
  }
  console.log(`stills: ${stills.join(", ")}`);
} else {
  const file = join(OUT, "op1-jam-teaser.mp4");
  const ffmpeg = spawn(
    "ffmpeg",
    [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
      "-i", join(OUT, "soundtrack.wav"),
      "-map", "0:v", "-map", "1:a",
      "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-profile:v", "high",
      "-c:a", "aac", "-b:a", "320k", "-ar", "48000",
      "-movflags", "+faststart", "-shortest", file,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  const total = SECONDS * FPS;
  const started = Date.now();
  for (let f = 0; f < total; f++) {
    await page.evaluate((x) => window.renderFrame(x), f);
    const png = await page.screenshot({ type: "png" });
    if (!ffmpeg.stdin.write(png)) await once(ffmpeg.stdin, "drain");
    if (f % 300 === 0) process.stdout.write(`${f / FPS}s `);
  }
  ffmpeg.stdin.end();
  const [code] = await once(ffmpeg, "close");
  console.log(`\nencoded in ${((Date.now() - started) / 1000).toFixed(0)}s, ffmpeg exit ${code}: ${file}`);
}

console.log(errors.length ? `page errors: ${errors.slice(0, 3).join(" | ")}` : "no page errors");
await browser.close();
site.close();
