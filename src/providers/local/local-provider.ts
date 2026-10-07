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
import { parseLocalErrorBody } from "./error-body.js";
import { localModelListSchema, type LocalModel } from "./schemas.js";

/** Short, because a local server can be restarted with another model at any time. */
const MODEL_CACHE_TTL_MS = 60 * 1000;

export interface LocalProviderOptions {
  baseUrl: string;
  /** Optional; when undefined no Authorization header is sent. */
  apiKey?: string | undefined;
  timeoutMs?: number;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Injected for tests; defaults to Date.now. */
  now?: () => number;
}

/**
 * A System One-compatible server on the user's machine or network, verified with
 * llama.cpp's `llama-server` serving Clef Flash (docs/local-provider.md). Requests use
 * the TypeSafe wire format; images use the server's `images` field of data URLs.
 */
export class LocalProvider implements JevProvider {
  readonly #client: JsonHttpClient;
  readonly #now: () => number;
  #modelCache: { loadedAt: number; models: LocalModel[] } | undefined;

  constructor(options: LocalProviderOptions) {
    this.#client = new JsonHttpClient({
      label: "Local server",
      baseUrl: options.baseUrl,
      parseErrorBody: parseLocalErrorBody,
      ...(options.apiKey !== undefined && { apiKey: options.apiKey }),
      ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
      ...(options.fetch !== undefined && { fetch: options.fetch }),
    });
    this.#now = options.now ?? Date.now;
  }

  /** Decision models only. The server provides no descriptions or release dates. */
  async models(options: JevRequestOptions = {}): Promise<JevModelList> {
    const models = await this.#loadDecisionModels(options);
    return { models: models.map((model) => ({ name: model.id })) };
  }

  async evaluate(
    request: JevEvaluateRequest,
    options: JevRequestOptions = {},
  ): Promise<JevEvaluateResult> {
    const payload = toSystemOnePayload(request);
    if (request.images !== undefined) {
      const model = await this.#resolveModel(request.model, options);
      assertAcceptsImages(model, request);
      payload.images = request.images.map((image) => `data:${image.mediaType};base64,${image.base64}`);
    }
    const body = await this.#client.request("POST", "/v1/systemone", payload, options);
    return parseSystemOneResponse(body, "Local server");
  }

  async #loadDecisionModels(options: JevRequestOptions): Promise<LocalModel[]> {
    const cache = this.#modelCache;
    if (cache !== undefined && this.#now() - cache.loadedAt < MODEL_CACHE_TTL_MS) return cache.models;

    const body = await this.#client.request("GET", "/v1/models", undefined, options);
    const parsed = localModelListSchema.safeParse(body);
    if (!parsed.success) {
      throw new JevError("invalid_response", "Local server /v1/models response failed validation", {
        details: { issues: parsed.error.issues },
      });
    }
    const models = parsed.data.data.filter(
      (model) => model.architecture?.output_modalities?.includes("decisions") === true,
    );
    this.#modelCache = { loadedAt: this.#now(), models };
    return models;
  }

  /**
   * Finds the model a request names, by ID or alias. llama-server serves a single model
   * and answers whatever `model` says, so when exactly one decision model is listed it
   * is the one that will answer.
   */
  async #resolveModel(name: string, options: JevRequestOptions): Promise<LocalModel> {
    const models = await this.#loadDecisionModels(options);
    const named = models.find((model) => model.id === name || model.aliases?.includes(name));
    if (named !== undefined) return named;
    if (models.length === 1) return models[0]!;
    throw new JevError(
      "invalid_input",
      models.length === 0
        ? "The local server lists no decision model"
        : `Model ${name} is not served by the local server (decision models: ${models.map((m) => m.id).join(", ")})`,
    );
  }
}

function assertAcceptsImages(model: LocalModel, request: JevEvaluateRequest): void {
  if (model.architecture?.input_modalities?.includes("image") !== true) {
    throw new JevError(
      "invalid_input",
      `The local model ${model.id} does not accept images; start the server with its multimodal projector (llama-server --mmproj)`,
    );
  }
  // Measured on 2026-10-07 with llama-server b11462: WebP fails with HTTP 500
  // "Failed to load image or audio file", while PNG and JPEG work.
  if (model.owned_by === "llamacpp" && request.images?.some((image) => image.mediaType === "image/webp")) {
    throw new JevError(
      "invalid_input",
      "llama-server cannot load WebP images; convert them to PNG or JPEG",
    );
  }
}
