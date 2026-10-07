import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JevCore } from "../core/jev-core.js";
import { jevEvaluateInputSchema } from "../schemas/evaluate.js";
import { jevEvaluateResultSchema, jevModelListSchema } from "../schemas/results.js";
import { toolError, toolSuccess } from "./tool-results.js";

const EVALUATE_DESCRIPTION = `Ask TypeSafe Jev typed questions about a piece of state and get calibrated probabilities back.

Send the content to judge as \`state\` (a string, or a JSON object/array for structured data) and a map of \`questions\` keyed by IDs you choose. All questions are answered in parallel against the same state, in one request, and cannot see each other's answers.

Question types:
- noul: a yes/no question. Returns \`noul\`, the probability of yes (0..1). Optional \`criteria\` { true, false } describes what yes and no mean.
- choice: pick one option. \`criteria\` maps option names to descriptions (or null), up to 255 options. Returns \`choice\`, \`probabilities\` per option and \`confidence\`.
- score: rate along ordered levels. \`criteria\` is an array of 2-10 level descriptions, lowest first. Returns \`score\` (a probability-weighted level index from 0, may fall between levels), \`legend\`, \`probabilities\` and \`confidence\`.

Question IDs are not shown to the model, so \`instructions\` must state the full question. Refer to parts of structured state with backticked paths such as \`ticket.messages[0].text\`. Ask one narrow judgment per question. \`model\` is optional and defaults to the server's configured model.`;

export function registerJevTools(server: McpServer, core: JevCore): void {
  server.registerTool(
    "jev.evaluate",
    {
      title: "Evaluate with Jev",
      description: EVALUATE_DESCRIPTION,
      inputSchema: jevEvaluateInputSchema,
      outputSchema: jevEvaluateResultSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input, extra) => {
      try {
        return toolSuccess({ ...(await core.evaluate(input, { signal: extra.signal })) });
      } catch (error) {
        return toolError(error, extra.signal);
      }
    },
  );

  server.registerTool(
    "jev.models",
    {
      title: "List Jev models",
      description:
        "List the model names and aliases the configured provider accepts in jev.evaluate's `model` field.",
      outputSchema: jevModelListSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (extra) => {
      try {
        return toolSuccess({ ...(await core.models({ signal: extra.signal })) });
      } catch (error) {
        return toolError(error, extra.signal);
      }
    },
  );
}
