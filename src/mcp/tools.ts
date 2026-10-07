import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import type { JevCore } from "../core/jev-core.js";
import type { JevRequestOptions } from "../core/provider.js";
import type { Logger } from "../observability/logger.js";
import {
  jevChoiceInputSchema,
  jevNoulInputSchema,
  jevScoreInputSchema,
} from "../schemas/convenience.js";
import { jevEvaluateBatchInputSchema, MAX_BATCH_ITEMS } from "../schemas/batch.js";
import { jevEvaluateInputSchema, type JevQuestion } from "../schemas/evaluate.js";
import {
  jevChoiceResultSchema,
  jevEvaluateBatchResultSchema,
  jevEvaluateResultSchema,
  jevModelListSchema,
  jevNoulResultSchema,
  jevScoreResultSchema,
} from "../schemas/results.js";
import { toolError, toolSuccess } from "./tool-results.js";

/** Question ID used when a convenience tool wraps its input in a jev.evaluate request. */
const SINGLE_QUESTION_ID = "question";

const IMAGES_HELP = `\`images\` (optional, up to 4 PNG, JPEG or WebP, 4 MiB each) are judged together with \`state\`; each is either { "path": "<absolute path>" } for a local file inside a directory the server allows (JEV_IMAGE_DIRS), or { "data": "data:image/png;base64,..." }. Only image-capable models accept images (for example cloudflare/clef or cloudflare/clef-flash through OpenRouter); other models reject them. Never put images inside \`state\`.`;

const SHARED_SINGLE_QUESTION_HELP = `\`state\` is the content to judge (a string, or a JSON object/array). \`instructions\` must state the full question; refer to parts of structured state with backticked paths such as \`ticket.messages[0].text\`. \`model\` is optional. ${IMAGES_HELP} To ask several questions about the same state, use jev.evaluate instead: it answers them in one request.`;

const NOUL_DESCRIPTION = `Ask TypeSafe Jev one yes/no question about some state. Returns \`answer.noul\`, the probability of yes (0..1); 0.5 means equally likely, not "medium". Optional \`criteria\` { true, false } describes what yes and no mean.

${SHARED_SINGLE_QUESTION_HELP}`;

const CHOICE_DESCRIPTION = `Ask TypeSafe Jev to pick one option for some state. \`criteria\` maps option names to descriptions (or null), up to 255 options; include a "none" option when nothing may fit. Returns \`answer.choice\`, \`answer.probabilities\` per option and \`answer.confidence\`.

${SHARED_SINGLE_QUESTION_HELP}`;

const SCORE_DESCRIPTION = `Ask TypeSafe Jev to rate some state along ordered levels. \`criteria\` is an array of 2-10 level descriptions, lowest first. Returns \`answer.score\` (a probability-weighted level index from 0, may fall between levels), \`answer.legend\`, \`answer.probabilities\` and \`answer.confidence\`.

${SHARED_SINGLE_QUESTION_HELP}`;

interface SingleQuestionInput {
  state: unknown;
  model?: string | undefined;
  instructions: unknown;
  criteria?: unknown;
  images?: unknown;
}

/** Runs one question through the same JevCore.evaluate path as jev.evaluate. */
async function evaluateSingleQuestion(
  core: JevCore,
  type: JevQuestion["type"],
  input: SingleQuestionInput,
  options: JevRequestOptions,
): Promise<Record<string, unknown>> {
  const { state, model, instructions, criteria, images } = input;
  const result = await core.evaluate(
    {
      state,
      ...(model !== undefined && { model }),
      ...(images !== undefined && { images }),
      questions: {
        [SINGLE_QUESTION_ID]: {
          type,
          instructions,
          ...(criteria !== undefined && { criteria }),
        },
      },
    },
    options,
  );
  // JevCore guarantees exactly one answer of the requested type.
  return { model: result.model, answer: result.answers[SINGLE_QUESTION_ID], usage: result.usage };
}

function registerSingleQuestionTool(
  server: McpServer,
  core: JevCore,
  logger: Logger,
  tool: {
    name: string;
    title: string;
    type: JevQuestion["type"];
    description: string;
    inputSchema: z.ZodType<SingleQuestionInput>;
    outputSchema: z.ZodObject;
  },
): void {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input, extra) => {
      try {
        return toolSuccess(
          await evaluateSingleQuestion(core, tool.type, input, { signal: extra.signal }),
        );
      } catch (error) {
        return toolError(error, extra.signal, logger);
      }
    },
  );
}

const EVALUATE_DESCRIPTION = `Ask TypeSafe Jev typed questions about a piece of state and get calibrated probabilities back.

Send the content to judge as \`state\` (a string, or a JSON object/array for structured data) and a map of \`questions\` keyed by IDs you choose. All questions are answered in parallel against the same state, in one request, and cannot see each other's answers.

Question types:
- noul: a yes/no question. Returns \`noul\`, the probability of yes (0..1). Optional \`criteria\` { true, false } describes what yes and no mean.
- choice: pick one option. \`criteria\` maps option names to descriptions (or null), up to 255 options. Returns \`choice\`, \`probabilities\` per option and \`confidence\`.
- score: rate along ordered levels. \`criteria\` is an array of 2-10 level descriptions, lowest first. Returns \`score\` (a probability-weighted level index from 0, may fall between levels), \`legend\`, \`probabilities\` and \`confidence\`.

Question IDs are not shown to the model, so \`instructions\` must state the full question. Refer to parts of structured state with backticked paths such as \`ticket.messages[0].text\`. Ask one narrow judgment per question. \`model\` is optional and defaults to the server's configured model.

${IMAGES_HELP}`;

const EVALUATE_BATCH_DESCRIPTION = `Ask TypeSafe Jev the same typed questions about many items (up to ${MAX_BATCH_ITEMS}) in one call, for example to classify a list of tickets or to score every search result and sort them.

\`items\` is a list of { "state": ..., "id"?: "...", "images"?: [...] }; each item is judged on its own. \`questions\` and the optional \`model\` work exactly as in jev.evaluate and apply to every item. Use a choice question to classify, a score or noul question to rank, and several questions to tag.

Each item is a separate provider request and is billed separately. Every item is checked before anything is sent; one invalid item rejects the whole call. Returns \`results\` in input order: \`status\` "ok" with \`answers\` and \`usage\`, "error" with the item's own \`error\`, or "skipped" when an earlier error (for example authentication or no credits) would also have hit it. \`summary\` counts each status and \`usage\` adds up the successful items.

${IMAGES_HELP.replace("judged together with `state`", "judged together with the item's `state`")}`;

export function registerJevTools(server: McpServer, core: JevCore, logger: Logger): void {
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
        return toolError(error, extra.signal, logger);
      }
    },
  );

  server.registerTool(
    "jev.evaluate_batch",
    {
      title: "Evaluate many items with Jev",
      description: EVALUATE_BATCH_DESCRIPTION,
      inputSchema: jevEvaluateBatchInputSchema,
      outputSchema: jevEvaluateBatchResultSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input, extra) => {
      try {
        return toolSuccess({ ...(await core.evaluateBatch(input, { signal: extra.signal })) });
      } catch (error) {
        return toolError(error, extra.signal, logger);
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
        return toolError(error, extra.signal, logger);
      }
    },
  );

  registerSingleQuestionTool(server, core, logger, {
    name: "jev.noul",
    title: "Yes/no question with Jev",
    type: "noul",
    description: NOUL_DESCRIPTION,
    inputSchema: jevNoulInputSchema,
    outputSchema: jevNoulResultSchema,
  });

  registerSingleQuestionTool(server, core, logger, {
    name: "jev.choice",
    title: "Choose an option with Jev",
    type: "choice",
    description: CHOICE_DESCRIPTION,
    inputSchema: jevChoiceInputSchema,
    outputSchema: jevChoiceResultSchema,
  });

  registerSingleQuestionTool(server, core, logger, {
    name: "jev.score",
    title: "Score on a scale with Jev",
    type: "score",
    description: SCORE_DESCRIPTION,
    inputSchema: jevScoreInputSchema,
    outputSchema: jevScoreResultSchema,
  });
}
