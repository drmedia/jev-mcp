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
  model: modelField,
  answers: z.record(z.string(), jevAnswerSchema).describe("One answer per question ID"),
  usage: usageSchema,
});

/** Result of a single-question convenience tool (jev.noul, jev.choice, jev.score). */
function singleAnswerResultSchema<T extends z.ZodType>(answer: T) {
  return z.object({ model: modelField, answer, usage: usageSchema });
}

export const jevNoulResultSchema = singleAnswerResultSchema(jevNoulAnswerSchema);
export const jevChoiceResultSchema = singleAnswerResultSchema(jevChoiceAnswerSchema);
export const jevScoreResultSchema = singleAnswerResultSchema(jevScoreAnswerSchema);

export const jevModelListSchema = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      description: z.string().optional(),
      releaseDate: z.string().optional(),
    }),
  ),
});
