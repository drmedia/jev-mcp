import { z } from "zod";
import { descriptionSchema } from "./evaluate.js";

// Output schemas advertised to MCP clients. They describe JevCore results,
// not a specific provider's wire format.

const probability = z.number().min(0).max(1);

export const jevAnswerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("noul"),
    noul: probability.describe("Probability that the answer is yes"),
  }),
  z.object({
    type: z.literal("choice"),
    choice: z.string().describe("The highest-probability option"),
    confidence: probability,
    probabilities: z.record(z.string(), probability).describe("Probability of each option"),
  }),
  z.object({
    type: z.literal("score"),
    score: z.number().min(0).describe("Probability-weighted level, starting at 0"),
    confidence: probability,
    legend: z.record(z.string(), descriptionSchema).describe("Level index mapped to its description"),
    probabilities: z.record(z.string(), probability).describe("Probability of each level"),
  }),
]);

export const jevEvaluateResultSchema = z.object({
  model: z.string().describe("The model that answered, usually a versioned ID"),
  answers: z.record(z.string(), jevAnswerSchema).describe("One answer per question ID"),
  usage: z.object({
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
  }),
});

export const jevModelListSchema = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      releaseDate: z.string(),
    }),
  ),
});
