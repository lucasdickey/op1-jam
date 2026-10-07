import { native } from "../../shared/native";
import type { PatternRequest, PatternResponse } from "../../shared/types";

// Where the next loop comes from: the app's main process, which asks Claude
// (src/main/claude.ts). The caller gets a pattern or an Error, and an
// AbortError when `signal` aborts.

let nextId = 0;

function aborted(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

export async function requestPattern(
  body: PatternRequest,
  signal: AbortSignal,
): Promise<PatternResponse> {
  const app = native();
  if (!app) throw new Error("OP-1 Jam needs its app to ask Claude. Run it with npm run dev.");

  const id = `p${++nextId}`;
  const cancel = () => app.cancelPattern(id);
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const result = await app.writePattern(id, body);
    if (signal.aborted) throw aborted();
    if (!result.ok) throw new Error(result.error);
    return result.response;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
