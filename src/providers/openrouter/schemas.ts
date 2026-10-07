import { z } from "zod";

// Subset of OpenRouter's `GET /api/v1/models` entries used for model discovery
// (checked 2026-10-07). With `output_modalities=decisions` the list contains only
// decision models such as cloudflare/clef, cloudflare/clef-flash and typesafe/jev-1.13.
export const openRouterModelSchema = z.object({
  id: z.string(),
  description: z.string(),
  /** Unix timestamp in seconds. */
  created: z.number(),
  architecture: z
    .object({ output_modalities: z.array(z.string()).optional() })
    .optional(),
});

export const openRouterModelListSchema = z.object({
  data: z.array(openRouterModelSchema),
});
