import { z } from "zod";

// Subset of the `Model` schema of OpenRouter's `GET /api/v1/models`
// (https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties.md,
// checked 2026-10-07). `id`, `name`, `created` and `architecture` (with
// `input_modalities` and `output_modalities`) are required there; `description` is not.
// With `output_modalities=decisions` the list contains only decision models.
export const openRouterModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  /** Unix timestamp in seconds. */
  created: z.number().int(),
  architecture: z.object({
    input_modalities: z.array(z.string()),
    output_modalities: z.array(z.string()),
  }),
});

export const openRouterModelListSchema = z.object({
  data: z.array(openRouterModelSchema),
});

export type OpenRouterModel = z.infer<typeof openRouterModelSchema>;
