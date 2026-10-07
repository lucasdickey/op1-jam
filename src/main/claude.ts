import { generateObject } from "ai";
import { z } from "zod";
import { describeRequest, MAX_NOTES, SYSTEM, tidy } from "../shared/prompt";
import { LOOP_BARS, PARTS, STEPS_PER_BAR, type Pattern, type PatternRequest } from "../shared/types";

// Asks Claude for the next loop, through the Vercel AI Gateway. Runs in the
// app's main process only; the key is set on process.env by index.ts.

/** Gateway ids name a provider; a bare Anthropic id gets one. */
function gatewayModel(id: string): string {
  return id.includes("/") ? id : `anthropic/${id}`;
}

/**
 * The system prompt repeats on every call, seconds apart, so let the gateway
 * place Anthropic's cache breakpoints: repeats are read back at a tenth of the
 * price.
 */
const REPEATED_PREFIX_CACHING = { gateway: { caching: "auto" } };

/**
 * Opus at low effort. The call is on the clock — the loop keeps playing while
 * it runs, and the answer lands at the top of whichever loop comes next — so
 * effort is turned down from Opus 5.5's default of medium: a two-bar bassline
 * needs taste more than deliberation. OP1_MODEL swaps the model, e.g.
 * `anthropic/claude-opus-5.5-fast` for quicker answers at twice the price.
 */
const MODEL = gatewayModel(process.env.OP1_MODEL?.trim() || "anthropic/claude-opus-5.5");

/* --- What the browser sends ---------------------------------------------- */

const MAX_STEPS = Math.max(...LOOP_BARS) * STEPS_PER_BAR;

const NoteSchema = z.object({
  step: z.number().int().min(0).max(MAX_STEPS - 1),
  note: z.number().int().min(0).max(127),
  length: z.number().int().min(1).max(MAX_STEPS),
});

const PatternSchema = z.object({
  bars: z.literal(LOOP_BARS),
  notes: z.array(NoteSchema).max(MAX_NOTES * 2),
});

export const PatternRequestSchema = z.object({
  part: z.enum(PARTS),
  tempo: z.number().min(40).max(240),
  bars: z.literal(LOOP_BARS),
  direction: z.string().max(500),
  newDirection: z.boolean(),
  current: PatternSchema.nullable(),
  heard: z
    .array(
      z.object({
        note: z.number().int().min(0).max(127),
        step: z.number().int().min(0).max(MAX_STEPS - 1).nullable(),
        loopsAgo: z.number().int().min(0).max(16).nullable(),
        length: z.number().int().min(1).max(MAX_STEPS).nullable(),
      }),
    )
    .max(128),
  drumKeys: z.array(z.number().int().min(0).max(127)).max(24),
  tape: z.array(z.object({ part: z.enum(PARTS), pattern: PatternSchema })).max(4),
});

/* --- What Claude sends back ---------------------------------------------- */

// No ranges in the schema: a note one step past the loop is a small mistake,
// and rejecting the whole pattern over it would cost the person a loop of
// waiting. The ranges are enforced by `tidy` (lib/op1/prompt.ts) instead.
const Output = z.object({
  notes: z
    .array(
      z.object({
        step: z.number().int().describe("Start, in sixteenth-note steps from the top of the loop, 0-based."),
        note: z.number().int().describe("MIDI note number; 60 is middle C."),
        length: z.number().int().describe("How many steps the note holds, at least 1."),
      }),
    )
    .describe("Every note in the loop."),
  note: z
    .string()
    .describe("One short sentence to the player, in plain words, about what you wrote or changed."),
});

/* --- The call ------------------------------------------------------------- */

export async function writePattern(
  req: PatternRequest,
  abortSignal?: AbortSignal,
): Promise<{ pattern: Pattern; note: string }> {
  const { object } = await generateObject({
    model: MODEL,
    schema: Output,
    system: SYSTEM,
    prompt: describeRequest(req),
    // Thinking is charged against this ceiling too; the pattern itself is a
    // few hundred tokens to a couple of thousand for a busy arpeggio.
    maxOutputTokens: 8000,
    maxRetries: 1,
    abortSignal,
    // The system prompt repeats on every call, a few seconds apart, for as
    // long as the page plays — the case caching is for.
    providerOptions: { ...REPEATED_PREFIX_CACHING, anthropic: { effort: "low" } },
  });

  return {
    pattern: tidy(object.notes, req),
    note: object.note.trim().slice(0, 300),
  };
}

/**
 * An error as one line for the page's status line. The gateway's messages
 * are written for a terminal — colour codes and several paragraphs of advice
 * — so this keeps the first line without the colour.
 */
export function errorLine(err: unknown): string {
  const raw = err instanceof Error ? err.message : "";
  const first = raw.replace(/\u001b\[[0-9;]*m/g, "").split("\n")[0].trim();
  return first.slice(0, 200) || "Claude couldn't write a pattern.";
}
