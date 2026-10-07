import { JevError } from "../../core/errors.js";
import type { JevEvaluateRequest } from "../../core/provider.js";

// Clef's documented request rules (Cloudflare Workers AI model page and input schema,
// https://developers.cloudflare.com/workers-ai/models/clef-flash/, checked 2026-10-07).
// Jev accepts requests that break them; Clef answers them with HTTP 422. They are
// checked locally so the caller gets a clear message instead of a nested upstream error.
export const CLEF_MAX_QUESTIONS = 64;
export const CLEF_MIN_CHOICE_OPTIONS = 2;
const CLEF_QUESTION_ID = /^[A-Za-z0-9_.-]{1,100}$/;

/**
 * Total image bytes per request that Clef accepts through OpenRouter. Measured, not
 * documented: Clef documents 4 MiB per image, but OpenRouter estimates image tokens
 * from the encoded size and returns 413 above a context-window check. On 2026-10-07 a
 * single 389,000-byte image passed and 411,600 bytes failed, for both Clef models, and
 * the limit applies to the request total, not per image. Set just below the largest
 * size seen to pass. Other models differ: openai/gpt-6-luna-decisions accepted a
 * 624 KB photo. See docs/openrouter-notes.md.
 */
export const CLEF_MAX_TOTAL_IMAGE_BYTES = 384_000;

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
  const imageBytes = (request.images ?? []).reduce((sum, image) => sum + image.byteLength, 0);
  if (imageBytes > CLEF_MAX_TOTAL_IMAGE_BYTES) {
    problems.push(
      `images are ${Math.round(imageBytes / 1000)} KB in total; Clef on OpenRouter rejects more than about ${CLEF_MAX_TOTAL_IMAGE_BYTES / 1000} KB per request (HTTP 413), although Clef documents 4 MiB per image. Resize or recompress the images`,
    );
  }

  if (problems.length > 0) {
    throw new JevError(
      "invalid_input",
      `Model ${request.model} does not accept this request: ${problems.join("; ")}`,
    );
  }
}
