// What OP-1 Jam sends Claude, and how Claude's answer is trimmed to the loop.
// Plain Node, no app: `npm run test:prompt`.

import { describeRequest, tidy } from "../src/shared/prompt.ts";
import type { PatternRequest } from "../src/shared/types.ts";

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`}`);
}
function has(name: string, text: string, part: string) {
  check(name, text.includes(part), true);
}

const req: PatternRequest = {
  part: "bass",
  tempo: 112,
  bars: 2,
  direction: "D minor, sparse",
  newDirection: false,
  current: { bars: 2, notes: [{ step: 0, note: 38, length: 3 }, { step: 16, note: 41, length: 4 }] },
  heard: [
    { note: 62, step: 4, loopsAgo: 1, length: 2 },
    { note: 69, step: null, loopsAgo: null, length: null },
  ],
  drumKeys: [],
  tape: [{ part: "drums", pattern: { bars: 1, notes: [{ step: 0, note: 53, length: 1 }] } }],
};

const text = describeRequest(req);
has("names the part, tempo and loop", text, "Part: bass\nTempo: 112 BPM\nLoop: 2 bars (steps 0–31)");
has("marks an unchanged direction", text, 'Direction (unchanged): "D minor, sparse"');
has("lists what's playing with note names", text, "step 0: D2 (38), 3 steps");
has("places notes played in time", text, "1 loop ago, step 4: D4 (62), 2 steps");
has("lists notes played with the loop stopped", text, "with the loop stopped: A4 (69)");
has("lists parts on tape", text, "On tape — drums (1 bar):");

const drums = describeRequest({ ...req, part: "drums", bars: 4, direction: "", newDirection: true, heard: [], tape: [] });
has("drums with no keys learned fall back to the keyboard range", drums, "none learned yet — use notes 53–76");
has("a resized loop says so", drums, "write 4 bars this time");
has("a cleared direction says so", drums, "the person cleared the old one");

check(
  "tidy drops notes outside the loop, clamps lengths, dedupes and sorts",
  tidy(
    [
      { step: 40, note: 40, length: 1 },
      { step: -1, note: 40, length: 1 },
      { step: 30, note: 40, length: 8 },
      { step: 2, note: 200, length: 1 },
      { step: 0, note: 38, length: 0 },
      { step: 0, note: 38, length: 4 },
      { step: 0, note: 33, length: 2 },
    ],
    req,
  ),
  { bars: 2, notes: [{ step: 0, note: 33, length: 2 }, { step: 0, note: 38, length: 1 }, { step: 30, note: 40, length: 2 }] },
);
check(
  "drums keep only the kit's learned keys",
  tidy([{ step: 0, note: 53, length: 1 }, { step: 4, note: 54, length: 1 }], { ...req, part: "drums", drumKeys: [53, 55] }).notes,
  [{ step: 0, note: 53, length: 1 }],
);
check(
  "a pattern is capped at 128 notes",
  tidy(Array.from({ length: 300 }, (_, i) => ({ step: i % 32, note: 30 + Math.floor(i / 32), length: 1 })), req).notes.length,
  128,
);

console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
