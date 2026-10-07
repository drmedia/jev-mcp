import { JevError } from "../../core/errors.js";
import type {
  JevEvaluateRequest,
  JevEvaluateResult,
  JevModelList,
  JevProvider,
  JevRequestOptions,
} from "../../core/provider.js";
import { JsonHttpClient } from "../http/json-client.js";
import { parseSystemOneResponse, toSystemOnePayload } from "../systemone/wire.js";
import { parseErrorBody } from "./http-errors.js";
import { modelMetadataListSchema } from "./schemas.js";

export { DEFAULT_TIMEOUT_MS } from "../http/json-client.js";

export interface TypeSafeProviderOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

/** TypeSafe's own API: `GET /v1/models` and `POST /v1/systemone`. */
export class TypeSafeProvider implements JevProvider {
  readonly #client: JsonHttpClient;

  constructor(options: TypeSafeProviderOptions) {
    this.#client = new JsonHttpClient({
      label: "TypeSafe",
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      parseErrorBody,
      ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
      ...(options.fetch !== undefined && { fetch: options.fetch }),
    });
  }

  async models(options: JevRequestOptions = {}): Promise<JevModelList> {
    const body = await this.#client.request("GET", "/v1/models", undefined, options);
    const parsed = modelMetadataListSchema.safeParse(body);
    if (!parsed.success) {
      throw new JevError("invalid_response", "TypeSafe /v1/models response failed validation", {
        details: { issues: parsed.error.issues, body },
      });
    }
    return {
      models: parsed.data.models.map((model) => ({
        name: model.name,
        description: model.description,
        releaseDate: model.release_date,
      })),
    };
  }

  async evaluate(
    request: JevEvaluateRequest,
    options: JevRequestOptions = {},
  ): Promise<JevEvaluateResult> {
    // TypeSafe documents Jev input as "Text only ... No image, audio, or video input"
    // (https://docs.typesafe.ai/models.md). Never send an image to a text-only model.
    if (request.images !== undefined) {
      throw new JevError(
        "invalid_input",
        "TypeSafe models accept text only; for images use JEV_PROVIDER=openrouter with an image-capable model such as cloudflare/clef-flash",
      );
    }
    const body = await this.#client.request("POST", "/v1/systemone", toSystemOnePayload(request), options);
    return parseSystemOneResponse(body, "TypeSafe");
  }
}
