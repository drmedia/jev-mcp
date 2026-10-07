import { z } from "zod";
import {
  choiceCriteriaSchema,
  descriptionSchema,
  modelSchema,
  noulCriteriaSchema,
  scoreCriteriaSchema,
} from "./evaluate.js";

// Single-question inputs for jev.noul, jev.choice and jev.score. They reuse the
// jev.evaluate rules and are converted into one-question evaluate inputs.

const common = {
  state: descriptionSchema,
  model: modelSchema.optional(),
  instructions: descriptionSchema,
};

export const jevNoulInputSchema = z.strictObject({
  ...common,
  criteria: noulCriteriaSchema.optional(),
});

export const jevChoiceInputSchema = z.strictObject({
  ...common,
  criteria: choiceCriteriaSchema,
});

export const jevScoreInputSchema = z.strictObject({
  ...common,
  criteria: scoreCriteriaSchema,
});

export type JevNoulInput = z.infer<typeof jevNoulInputSchema>;
export type JevChoiceInput = z.infer<typeof jevChoiceInputSchema>;
export type JevScoreInput = z.infer<typeof jevScoreInputSchema>;
