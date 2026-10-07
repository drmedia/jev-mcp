/**
 * Usage guidance sent to MCP clients in the initialize result (`instructions`).
 * Clients such as Claude Code add it to the model's context, so it is written for
 * the calling AI, general-purpose, and never contains secrets, base URLs or local
 * paths. Update it whenever tools, providers or error kinds change.
 */

/**
 * Claude Code 2.1.289 keeps only the first 2048 characters of a server's
 * instructions (measured 2026-10-07), so the text stays below this limit.
 */
export const MAX_INSTRUCTIONS_LENGTH = 2048;

/** One line per known provider; providers are named by their configuration name. */
const PROVIDER_NOTES: Record<string, string> = {
  typesafe: "typesafe: Jev (jev-latest, jev-preview), text only.",
  openrouter:
    "openrouter: model required, e.g. cloudflare/clef-flash, cloudflare/clef (read images) or typesafe/jev-1.13; billed, see usage.costUsd.",
  local: "local: a model on the user's machine (e.g. clef-flash); only while that server runs.",
};

export interface InstructionsContext {
  providerNames: readonly string[];
  defaultProviderName: string;
}

function providerSection({ providerNames, defaultProviderName }: InstructionsContext): string {
  const notes = providerNames.flatMap((name) => (PROVIDER_NOTES[name] ? [`- ${PROVIDER_NOTES[name]}`] : []));
  const head =
    providerNames.length === 1
      ? `Provider: only "${defaultProviderName}" here; omit \`provider\`.`
      : `Providers: ${providerNames.join(", ")} (default ${defaultProviderName}). Pass \`provider\` (and \`model\`) to use another or to compare models; jev.models lists them.`;
  return [head, ...notes].join("\n");
}

export function buildServerInstructions(context: InstructionsContext): string {
  return `jev-mcp asks decision models (TypeSafe Jev and compatible) typed questions about content and returns calibrated probabilities. It never writes text or fills in missing answers.

Tools:
- jev.noul: one yes/no question. jev.choice: pick one option (classify). jev.score: rate on ordered levels.
- jev.evaluate: several questions about one content in one request (cheaper).
- jev.evaluate_batch: the same questions about up to 100 items (classify a list, rank candidates); each item is a billed request.

Errors (error.kind):
- invalid_input, invalid_request: fix the input as the message says.
- authentication, authorization, payment_required, configuration: stop and tell the user.
- rate_limited, overloaded, timeout, network: already retried by the server; try later.
- refused: the model declined; rephrase or use another model.
- invalid_response, provider_error: report it. Never substitute a guessed probability.

Questions: put the content in \`state\`; \`instructions\` must state the whole question (IDs are not shown to the model). One narrow judgment per question; describe options or levels in \`criteria\`; add a "none" option to jev.choice when nothing may fit.

Results: noul is the probability of yes; choice and score add per-option probabilities and confidence. Near 0.5 means the question is ambiguous, not "medium": add the deciding rule to instructions or criteria instead of retrying. Probabilities are evidence, not facts; set thresholds per model from labeled examples.

Images: only Clef (openrouter or local) reads them; send them in \`images\`, never inside \`state\`.

${providerSection(context)}`;
}
