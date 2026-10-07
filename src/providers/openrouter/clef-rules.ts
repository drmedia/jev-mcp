import { JevError } from "../../core/errors.js";
import type { JevEvaluateRequest } from "../../core/provider.js";

// Clef's documented request rules (Cloudflare Workers AI model page and input schema,
// https://developers.cloudflare.com/workers-ai/models/clef-flash/, checked 2026-10-07).
// Jev accepts requests that break them; Clef answers them with HTTP 422. They are
// checked locally so the caller gets a clear message instead of a nested upstream error.
export const CLEF_MAX_QUESTIONS = 64;
export const CLEF_MIN_CHOICE_OPTIONS = 2;
const CLEF_QUESTION_ID = /^[A-Za-z0-9_.-]{1,100}$/;

/** Clef models on OpenRouter, e.g. `cloudflare/clef` and `cloudflare/clef-flash`. */
export function isClefModel(model: string): boolean {
  return /^cloudflare\/clef(?:$|[-:])/.test(model);
}

export function assertClefRequestRules(request: JevEvaluateRequest): void {
  const problems: string[] = [];
  const entries = Object.entries(request.questions);

  if (entries.length > CLEF_MAX_QUESTIONS) {
    problems.push(`at most ${CLEF_MAX_QUESTIONS} questions per request, got ${entries.length}`);
  }
  const badIds = entries.map(([id]) => id).filter((id) => !CLEF_QUESTION_ID.test(id));
  if (badIds.length > 0) {
    problems.push(
      `question IDs may only use letters, digits, "_", "." and "-" (up to 100 characters): ${badIds
        .map((id) => JSON.stringify(id))
        .join(", ")}`,
    );
  }
  for (const [id, question] of entries) {
    if (question.type === "choice" && Object.keys(question.criteria).length < CLEF_MIN_CHOICE_OPTIONS) {
      problems.push(`${id}: a choice needs at least ${CLEF_MIN_CHOICE_OPTIONS} options`);
    }
  }

  if (problems.length > 0) {
    throw new JevError(
      "invalid_input",
      `Model ${request.model} does not accept this request: ${problems.join("; ")}`,
    );
  }
}
