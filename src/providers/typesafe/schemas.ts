import { z } from "zod";

// Mirrors `ModelMetadataList` / `ModelMetadata` in https://api.typesafe.ai/openapi.json
// (API version 0.2.0, checked 2026-10-07). All three fields are required there.
export const modelMetadataSchema = z.object({
  name: z.string(),
  description: z.string(),
  release_date: z.string(),
});

export const modelMetadataListSchema = z.object({
  models: z.array(modelMetadataSchema),
});

export type ModelMetadataList = z.infer<typeof modelMetadataListSchema>;
