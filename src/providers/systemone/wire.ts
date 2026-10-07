import { z } from "zod";
import { JevError } from "../../core/errors.js";
import type { JevEvaluateRequest, JevEvaluateResult } from "../../core/provider.js";
import { descriptionSchema } from "../../schemas/evaluate.js";

// The System One wire format shared by TypeSafe (https://api.typesafe.ai/openapi.json,
// API version 0.2.0) and OpenRouter's System One API (`POST /api/v1/systemone`).
// Objects are not strict so new optional fields from either API do not break parsing.

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
    // Reported by OpenRouter in USD; TypeSafe does not send it.
    cost: z.number().nonnegative().optional(),
  }),
});

export type SystemOneResponse = z.infer<typeof systemOneResponseSchema>;

/** The request body is the provider-neutral request; both APIs accept it as is. */
export function toSystemOnePayload(request: JevEvaluateRequest): Record<string, unknown> {
  return { state: request.state, model: request.model, questions: request.questions };
}

/** Validates a System One response body and maps it to a JEV result. */
export function parseSystemOneResponse(body: unknown, providerLabel: string): JevEvaluateResult {
  const parsed = systemOneResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new JevError("invalid_response", `${providerLabel} System One response failed validation`, {
      details: { issues: parsed.error.issues, body },
    });
  }
  const { model, answers, usage } = parsed.data;
  return {
    model,
    answers,
    usage: {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      ...(usage.cost !== undefined && { costUsd: usage.cost }),
    },
  };
}
