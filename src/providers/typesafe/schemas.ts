import { z } from "zod";
import { descriptionSchema } from "../../schemas/evaluate.js";

// Mirrors https://api.typesafe.ai/openapi.json (API version 0.2.0, checked 2026-10-07).
// Objects are not strict so new optional fields from the API do not break parsing.

export const modelMetadataSchema = z.object({
  name: z.string(),
  description: z.string(),
  release_date: z.string(),
});

export const modelMetadataListSchema = z.object({
  models: z.array(modelMetadataSchema),
});

const noulAnswerSchema = z.object({
  type: z.literal("noul"),
  noul: z.number(),
});

const choiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: z.number(),
  probabilities: z.record(z.string(), z.number()),
});

const scoreAnswerSchema = z.object({
  type: z.literal("score"),
  score: z.number(),
  confidence: z.number(),
  legend: z.record(z.string(), descriptionSchema),
  probabilities: z.record(z.string(), z.number()),
});

export const systemOneResponseSchema = z.object({
  model: z.string(),
  answers: z.record(
    z.string(),
    z.discriminatedUnion("type", [noulAnswerSchema, choiceAnswerSchema, scoreAnswerSchema]),
  ),
  usage: z.object({
    input_tokens: z.number().int(),
    output_tokens: z.number().int(),
  }),
});

export type ModelMetadataList = z.infer<typeof modelMetadataListSchema>;
export type SystemOneResponse = z.infer<typeof systemOneResponseSchema>;
