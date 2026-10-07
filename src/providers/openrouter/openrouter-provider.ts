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
import { assertClefRequestRules, isClefModel } from "./clef-rules.js";
import { parseOpenRouterErrorBody } from "./error-body.js";
import { openRouterModelListSchema, type OpenRouterModel } from "./schemas.js";

export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api";

/** How long the decision-model list is reused for image capability checks. */
const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;

export interface OpenRouterProviderOptions {
  apiKey: string;
  /** API root without a version segment; `/v1/...` paths are appended. */
  baseUrl?: string;
  timeoutMs?: number;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Injected for tests; defaults to Date.now. */
  now?: () => number;
}

/**
 * OpenRouter's System One API (`POST /api/v1/systemone`), which accepts the same
 * request as TypeSafe and serves several decision models, e.g. `cloudflare/clef`,
 * `cloudflare/clef-flash`, `typesafe/jev-1.13` and `openai/gpt-6-luna-decisions`
 * (public beta). Bare Jev IDs such as `jev-latest` are mapped by OpenRouter onto the
 * `typesafe/` namespace.
 */
export class OpenRouterProvider implements JevProvider {
  readonly #client: JsonHttpClient;
  readonly #now: () => number;
  #modelCache: { loadedAt: number; models: OpenRouterModel[] } | undefined;

  constructor(options: OpenRouterProviderOptions) {
    this.#client = new JsonHttpClient({
      label: "OpenRouter",
      apiKey: options.apiKey,
      baseUrl: options.baseUrl ?? DEFAULT_OPENROUTER_BASE_URL,
      parseErrorBody: parseOpenRouterErrorBody,
      ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
      ...(options.fetch !== undefined && { fetch: options.fetch }),
    });
    this.#now = options.now ?? Date.now;
  }

  /** Decision models only; chat models cannot answer System One questions. */
  async models(options: JevRequestOptions = {}): Promise<JevModelList> {
    const models = await this.#loadDecisionModels(options);
    return {
      models: models.map((model) => ({
        name: model.id,
        // `description` is optional in OpenRouter's Model schema; `name` is required.
        description: model.description ?? model.name,
        // OpenRouter reports creation as Unix seconds; expose it as an ISO date.
        releaseDate: new Date(model.created * 1000).toISOString().slice(0, 10),
      })),
    };
  }

  async evaluate(
    request: JevEvaluateRequest,
    options: JevRequestOptions = {},
  ): Promise<JevEvaluateResult> {
    if (isClefModel(request.model)) assertClefRequestRules(request);
    const payload = toSystemOnePayload(request);
    if (request.images !== undefined) {
      await this.#assertAcceptsImages(request.model, options);
      payload.state = withImages(request);
    }
    const body = await this.#client.request("POST", "/v1/systemone", payload, options);
    return parseSystemOneResponse(body, "OpenRouter");
  }

  async #loadDecisionModels(options: JevRequestOptions): Promise<OpenRouterModel[]> {
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
    const models = parsed.data.data.filter((model) =>
      model.architecture.output_modalities.includes("decisions"),
    );
    this.#modelCache = { loadedAt: this.#now(), models };
    return models;
  }

  /**
   * A text-only model must never receive an image: Jev answers such a request with
   * HTTP 200 and meaningless probabilities. Only models that OpenRouter lists with an
   * `image` input modality pass; unknown IDs and aliases such as `jev-latest` fail.
   */
  async #assertAcceptsImages(model: string, options: JevRequestOptions): Promise<void> {
    const cache = this.#modelCache;
    const models =
      cache !== undefined && this.#now() - cache.loadedAt < MODEL_CACHE_TTL_MS
        ? cache.models
        : await this.#loadDecisionModels(options);

    const entry = models.find((candidate) => candidate.id === model);
    if (entry === undefined) {
      throw new JevError(
        "invalid_input",
        `Model ${model} is not listed by OpenRouter as a decision model that accepts images; use a full image-capable model ID such as cloudflare/clef-flash`,
      );
    }
    if (!entry.architecture.input_modalities.includes("image")) {
      throw new JevError(
        "invalid_input",
        `Model ${model} does not accept images (OpenRouter lists its inputs as: ${entry.architecture.input_modalities.join(", ")})`,
      );
    }
  }
}

/**
 * OpenRouter's System One API takes images as content parts inside a `state` array,
 * in the format its image guide documents for chat. This placement is not in the
 * System One reference; it is what the API asks for when sent a top-level `images`
 * field (see docs/openrouter-notes.md). Images go first, as Cloudflare's Clef schema
 * places them before the state.
 */
function withImages(request: JevEvaluateRequest): unknown[] {
  const parts = (request.images ?? []).map((image) => ({
    type: "image_url",
    image_url: { url: `data:${image.mediaType};base64,${image.base64}` },
  }));
  return [...parts, ...(Array.isArray(request.state) ? request.state : [request.state])];
}
