import { JevError } from "../../core/errors.js";
import type {
  JevModelList,
  JevProvider,
  JevRequestOptions,
} from "../../core/provider.js";
import { errorFromResponse } from "./http-errors.js";
import { modelMetadataListSchema } from "./schemas.js";

export const DEFAULT_TIMEOUT_MS = 30_000;

export interface TypeSafeProviderOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

export class TypeSafeProvider implements JevProvider {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: TypeSafeProviderOptions) {
    this.#apiKey = options.apiKey;
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async models(options: JevRequestOptions = {}): Promise<JevModelList> {
    const body = await this.#getJson("/v1/models", options);
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

  async #getJson(path: string, options: JevRequestOptions): Promise<unknown> {
    const timeoutSignal = AbortSignal.timeout(this.#timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;

    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          Accept: "application/json",
        },
        signal,
      });
    } catch (error) {
      // Caller cancellation is not a provider failure; surface it unchanged.
      if (options.signal?.aborted) throw error;
      if (timeoutSignal.aborted) {
        throw new JevError("timeout", `TypeSafe request timed out after ${this.#timeoutMs} ms`, {
          cause: error,
        });
      }
      throw new JevError("network", "Could not reach the TypeSafe API", { cause: error });
    }

    if (!response.ok) throw await errorFromResponse(response);

    const text = await response.text();
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new JevError("invalid_response", "TypeSafe API returned a non-JSON response", {
        status: response.status,
        details: text.slice(0, 2000),
        cause: error,
      });
    }
  }
}
