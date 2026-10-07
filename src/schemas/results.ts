import { z } from "zod";
import { descriptionSchema } from "./evaluate.js";

// Output schemas advertised to MCP clients. They describe JevCore results,
// not a specific provider's wire format.

const probability = z.number().min(0).max(1);

export const jevNoulAnswerSchema = z.object({
  type: z.literal("noul"),
  noul: probability.describe("Probability that the answer is yes"),
});

export const jevChoiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string().describe("The highest-probability option"),
  confidence: probability,
  probabilities: z.record(z.string(), probability).describe("Probability of each option"),
});

export const jevScoreAnswerSchema = z.object({
  type: z.literal("score"),
  score: z.number().min(0).describe("Probability-weighted level, starting at 0"),
  confidence: probability,
  legend: z.record(z.string(), descriptionSchema).describe("Level index mapped to its description"),
  probabilities: z.record(z.string(), probability).describe("Probability of each level"),
});

export const jevAnswerSchema = z.discriminatedUnion("type", [
  jevNoulAnswerSchema,
  jevChoiceAnswerSchema,
  jevScoreAnswerSchema,
]);

const modelField = z.string().describe("The model that answered, usually a versioned ID");
const providerField = z.string().describe("The provider that answered");

const usageSchema = z.object({
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  costUsd: z
    .number()
    .nonnegative()
    .optional()
    .describe("Cost in USD as reported by the provider; absent when the provider does not report it"),
});

export const jevEvaluateResultSchema = z.object({
  provider: providerField.optional(),
  model: modelField,
  answers: z.record(z.string(), jevAnswerSchema).describe("One answer per question ID"),
  usage: usageSchema,
});

const batchItemFields = {
  index: z.number().int().min(0).describe("Position of the item in `items`"),
  id: z.string().optional().describe("The item's `id`, when one was given"),
};

export const jevEvaluateBatchResultSchema = z.object({
  provider: providerField.describe("The provider every item was sent to"),
  results: z
    .array(
      z.discriminatedUnion("status", [
        z.object({
          ...batchItemFields,
          status: z.literal("ok"),
          model: modelField,
          answers: z.record(z.string(), jevAnswerSchema).describe("One answer per question ID"),
          usage: usageSchema,
        }),
        z.object({
          ...batchItemFields,
          status: z.literal("error"),
          error: z.object({ kind: z.string(), message: z.string(), status: z.number().int().optional() }),
        }),
        z.object({
          ...batchItemFields,
          status: z.literal("skipped"),
          reason: z.string().describe("Why the item was not sent"),
        }),
      ]),
    )
    .describe("One result per item, in input order"),
  summary: z.object({
    ok: z.number().int().min(0),
    error: z.number().int().min(0),
    skipped: z.number().int().min(0),
  }),
  usage: usageSchema.describe(
    "Sum over successful items; costUsd only when every successful item reported a cost",
  ),
});

/** Result of a single-question convenience tool (jev.noul, jev.choice, jev.score). */
function singleAnswerResultSchema<T extends z.ZodType>(answer: T) {
  return z.object({ provider: providerField.optional(), model: modelField, answer, usage: usageSchema });
}

export const jevNoulResultSchema = singleAnswerResultSchema(jevNoulAnswerSchema);
export const jevChoiceResultSchema = singleAnswerResultSchema(jevChoiceAnswerSchema);
export const jevScoreResultSchema = singleAnswerResultSchema(jevScoreAnswerSchema);

export const jevModelListSchema = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      provider: z.string().optional().describe("Pass this as `provider` to use the model"),
      description: z.string().optional(),
      releaseDate: z.string().optional(),
    }),
  ),
  errors: z
    .array(z.object({ provider: z.string(), kind: z.string(), message: z.string() }))
    .optional()
    .describe("Providers whose model list could not be read"),
});
