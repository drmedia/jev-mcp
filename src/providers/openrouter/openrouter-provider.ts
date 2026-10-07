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
import { parseOpenRouterErrorBody } from "./error-body.js";
import { openRouterModelListSchema } from "./schemas.js";

export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api";

export interface OpenRouterProviderOptions {
  apiKey: string;
  /** API root without a version segment; `/v1/...` paths are appended. */
  baseUrl?: string;
  timeoutMs?: number;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

/**
 * OpenRouter's System One API (`POST /api/v1/systemone`), which accepts the same
 * request as TypeSafe and serves several decision models, e.g. `cloudflare/clef`,
 * `cloudflare/clef-flash` and `typesafe/jev-1.13`. Bare Jev IDs such as `jev-latest`
 * are mapped by OpenRouter onto the `typesafe/` namespace.
 */
export class OpenRouterProvider implements JevProvider {
  readonly #client: JsonHttpClient;

  constructor(options: OpenRouterProviderOptions) {
    this.#client = new JsonHttpClient({
      label: "OpenRouter",
      apiKey: options.apiKey,
      baseUrl: options.baseUrl ?? DEFAULT_OPENROUTER_BASE_URL,
      parseErrorBody: parseOpenRouterErrorBody,
      ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
      ...(options.fetch !== undefined && { fetch: options.fetch }),
    });
  }

  /** Decision models only; chat models cannot answer System One questions. */
  async models(options: JevRequestOptions = {}): Promise<JevModelList> {
    const body = await this.#client.request(
      "GET",
      "/v1/models?output_modalities=decisions",
      undefined,
      options,
    );
    const parsed = openRouterModelListSchema.safeParse(body);
    if (!parsed.success) {
      throw new JevError("invalid_response", "OpenRouter /v1/models response failed validation", {
        details: { issues: parsed.error.issues },
      });
    }
    return {
      models: parsed.data.data
        .filter((model) => model.architecture?.output_modalities?.includes("decisions") ?? true)
        .map((model) => ({
          name: model.id,
          description: model.description,
          // OpenRouter reports creation as Unix seconds; expose it as an ISO date.
          releaseDate: new Date(model.created * 1000).toISOString().slice(0, 10),
        })),
    };
  }

  async evaluate(
    request: JevEvaluateRequest,
    options: JevRequestOptions = {},
  ): Promise<JevEvaluateResult> {
    const body = await this.#client.request("POST", "/v1/systemone", toSystemOnePayload(request), options);
    return parseSystemOneResponse(body, "OpenRouter");
  }
}
