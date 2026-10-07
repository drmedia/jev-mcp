import { z } from "zod";

// `GET /v1/models` of a local System One server. Shape follows llama.cpp's llama-server
// (OpenAI-style list, tools/server/README.md "GET /v1/models", checked 2026-10-07):
// `architecture.output_modalities` contains "decisions" for native decision models and
// `input_modalities` lists "image" when a multimodal projector is loaded. The server
// does not describe models or report release dates, so neither is read.
export const localModelSchema = z.object({
  id: z.string(),
  aliases: z.array(z.string()).optional(),
  owned_by: z.string().optional(),
  architecture: z
    .object({
      input_modalities: z.array(z.string()).optional(),
      output_modalities: z.array(z.string()).optional(),
    })
    .optional(),
});

export const localModelListSchema = z.object({
  data: z.array(localModelSchema),
});

export type LocalModel = z.infer<typeof localModelSchema>;
