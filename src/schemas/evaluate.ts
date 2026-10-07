import { z } from "zod";

// Limits follow https://docs.typesafe.ai/api.md. The OpenAPI schema is looser
// (see docs/typesafe-api-notes.md); we validate against the documented contract.
export const MAX_CHOICE_OPTIONS = 255;
export const MIN_SCORE_LEVELS = 2;
export const MAX_SCORE_LEVELS = 10;

/** Free-form text, structured object, or array used for state, instructions and criteria. */
export const descriptionSchema = z.union([
  z.string(),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);

export const noulCriteriaSchema = z.strictObject({
  true: descriptionSchema.optional(),
  false: descriptionSchema.optional(),
});

export const choiceCriteriaSchema = z
  .record(z.string().min(1, "option names must not be empty"), descriptionSchema.nullable())
  .refine((criteria) => Object.keys(criteria).length >= 1, "must define at least one option")
  .refine(
    (criteria) => Object.keys(criteria).length <= MAX_CHOICE_OPTIONS,
    `must define at most ${MAX_CHOICE_OPTIONS} options`,
  );

export const scoreCriteriaSchema = z
  .array(descriptionSchema)
  .min(MIN_SCORE_LEVELS, `must define at least ${MIN_SCORE_LEVELS} levels`)
  .max(MAX_SCORE_LEVELS, `must define at most ${MAX_SCORE_LEVELS} levels`);

export const modelSchema = z.string().trim().min(1, "must not be empty");

const noulQuestionSchema = z.strictObject({
  type: z.literal("noul"),
  instructions: descriptionSchema,
  criteria: noulCriteriaSchema.optional(),
});

const choiceQuestionSchema = z.strictObject({
  type: z.literal("choice"),
  instructions: descriptionSchema,
  criteria: choiceCriteriaSchema,
});

const scoreQuestionSchema = z.strictObject({
  type: z.literal("score"),
  instructions: descriptionSchema,
  criteria: scoreCriteriaSchema,
});

export const jevQuestionSchema = z.discriminatedUnion("type", [
  noulQuestionSchema,
  choiceQuestionSchema,
  scoreQuestionSchema,
]);

export const jevEvaluateInputSchema = z.strictObject({
  state: descriptionSchema,
  model: modelSchema.optional(),
  questions: z
    .record(z.string().min(1, "question ids must not be empty"), jevQuestionSchema)
    .refine((questions) => Object.keys(questions).length >= 1, "must contain at least one question"),
});

export type JevDescription = z.infer<typeof descriptionSchema>;
export type JevNoulQuestion = z.infer<typeof noulQuestionSchema>;
export type JevChoiceQuestion = z.infer<typeof choiceQuestionSchema>;
export type JevScoreQuestion = z.infer<typeof scoreQuestionSchema>;
export type JevQuestion = z.infer<typeof jevQuestionSchema>;
export type JevEvaluateInput = z.infer<typeof jevEvaluateInputSchema>;
