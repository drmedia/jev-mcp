/**
 * Usage guidance sent to MCP clients in the initialize result (`instructions`).
 * Clients such as Claude Code keep it in the model's context in every session, so it
 * holds only what the tool descriptions do not: which tool to open, what to do on
 * errors, how to treat ambiguous results, and which providers this server offers.
 * Question writing, result fields and image rules live in the tool descriptions.
 * General-purpose; never secrets, base URLs or local paths. Update it whenever tools,
 * providers or error kinds change.
 */

/**
 * Claude Code 2.1.289 keeps only the first 2048 characters of a server's
 * instructions (measured 2026-10-07); the text stays well below that.
 */
export const MAX_INSTRUCTIONS_LENGTH = 2048;

export interface InstructionsContext {
  providerNames: readonly string[];
  defaultProviderName: string;
}

function providerLine({ providerNames, defaultProviderName }: InstructionsContext): string {
  if (providerNames.length === 1) return `Provider: only "${defaultProviderName}"; omit \`provider\`.`;
  const notes = [
    providerNames.includes("openrouter") ? "openrouter needs `model`" : "",
    providerNames.includes("local") ? "local works only while the user's local server runs" : "",
  ].filter((note) => note !== "");
  return `Providers: ${providerNames.join(", ")} (default ${defaultProviderName}); pass \`provider\` and \`model\` to switch or compare${notes.length > 0 ? `; ${notes.join("; ")}` : ""}.`;
}

export function buildServerInstructions(context: InstructionsContext): string {
  return `jev-mcp returns calibrated probabilities from decision models (TypeSafe Jev and compatible). It never writes text or invents answers.

Tools: jev.noul (one yes/no), jev.choice (pick one option), jev.score (ordered levels), jev.evaluate (several questions about one content, one request), jev.evaluate_batch (same questions for up to 100 items, each billed), jev.models.

A result near 0.5 means the question is ambiguous: add the deciding rule to it instead of retrying. Probabilities are evidence, not facts.

Errors (error.kind): invalid_input or invalid_request, fix the input; authentication, authorization, payment_required or configuration, stop and tell the user; rate_limited, overloaded, timeout or network were already retried, try later; refused, rephrase or switch model; invalid_response or provider_error, report it. Never substitute a guessed probability.

${providerLine(context)}`;
}
