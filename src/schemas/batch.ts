import { z } from "zod";
import { descriptionSchema, imagesSchema, modelSchema, providerNameSchema, questionsSchema } from "./evaluate.js";

/**
 * Items per jev.evaluate_batch call. Each item is one provider request and is billed
 * separately, so the limit keeps a single tool call from running up a large bill.
 */
export const MAX_BATCH_ITEMS = 100;

export const batchItemSchema = z.strictObject({
  id: z
    .string()
    .min(1, "item ids must not be empty")
    .optional()
    .describe("Optional ID you choose; returned with the item's result"),
  state: descriptionSchema,
  images: imagesSchema.optional(),
});

export const jevEvaluateBatchInputSchema = z.strictObject({
  items: z
    .array(batchItemSchema)
    .min(1, "must contain at least one item")
    .max(MAX_BATCH_ITEMS, `must contain at most ${MAX_BATCH_ITEMS} items`)
    .refine((items) => {
      const ids = items.flatMap((item) => (item.id === undefined ? [] : [item.id]));
      return new Set(ids).size === ids.length;
    }, "item ids must be unique"),
  provider: providerNameSchema.optional(),
  model: modelSchema.optional(),
  questions: questionsSchema,
});

export type JevBatchItem = z.infer<typeof batchItemSchema>;
export type JevEvaluateBatchInput = z.infer<typeof jevEvaluateBatchInputSchema>;
