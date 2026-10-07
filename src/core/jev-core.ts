import type { z } from "zod";
import type { ImageFileLoader } from "../images/directory-image-loader.js";
import { excerpt, silentLogger, type Logger } from "../observability/logger.js";
import {
  checkImageSet,
  containsImagePart,
  imageFromBytes,
  imageFromDataUrl,
} from "../images/image-data.js";
import {
  jevEvaluateInputSchema,
  type JevEvaluateInput,
  type JevImageSource,
} from "../schemas/evaluate.js";
import { jevEvaluateBatchInputSchema, type JevBatchItem } from "../schemas/batch.js";
import {
  BATCH_STOPPING_ERROR_KINDS,
  totalBatchUsage,
  type JevBatchItemResult,
  type JevBatchResult,
} from "./batch.js";
import { JevError } from "./errors.js";
import type {
  JevEvaluateRequest,
  JevEvaluateResult,
  JevImage,
  JevModelList,
  JevProvider,
  JevRequestOptions,
} from "./provider.js";

/** A provider clients may select by name, besides the default one. */
export interface JevProviderEntry {
  provider: JevProvider;
  /** Used when a request selects this provider without a model; without it, a model is required. */
  defaultModel?: string;
}

export interface JevCoreOptions {
  /** The default provider, used when an input does not name one. */
  provider: JevProvider;
  /** Used when an input selects the default provider without naming a model. */
  defaultModel: string;
  /** Name clients use for the default provider. Defaults to "default". */
  providerName?: string;
  /** More providers clients may select with `provider`, keyed by name. */
  additionalProviders?: Record<string, JevProviderEntry>;
  /** Reads `images[].path` entries. Without it, image paths are rejected. */
  loadImageFile?: ImageFileLoader;
  /**
   * Maximum characters of text input (`state` and `questions` as JSON) per request.
   * Some models accept and bill inputs beyond their documented context, so oversized
   * requests are stopped before they are sent. Omitted or 0 disables the check.
   */
  maxInputChars?: number;
  /** Maximum provider requests evaluateBatch runs at the same time. Defaults to 4. */
  maxConcurrency?: number;
  /** Receives per-request diagnostics. Defaults to discarding them. */
  logger?: Logger;
}

const DEFAULT_MAX_CONCURRENCY = 4;

/** The provider a request goes to, and the request built for it. */
interface Prepared {
  providerName: string;
  provider: JevProvider;
  request: JevEvaluateRequest;
}

function formatIssues(issues: readonly z.core.$ZodIssue[]): string {
  return issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`)
    .join("; ");
}

function isProbability(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function allProbabilities(values: Record<string, number>): boolean {
  return Object.values(values).every(isProbability);
}

/**
 * Returns a list of problems where the provider's answers do not correspond to
 * the questions that were asked. An empty list means the result is consistent.
 */
export function findAnswerProblems(
  request: JevEvaluateRequest,
  result: JevEvaluateResult,
): string[] {
  const problems: string[] = [];

  for (const id of Object.keys(result.answers)) {
    if (!(id in request.questions)) problems.push(`${id}: answer for a question that was not asked`);
  }

  for (const [id, question] of Object.entries(request.questions)) {
    const answer = result.answers[id];
    if (answer === undefined) {
      problems.push(`${id}: missing answer`);
      continue;
    }
    if (answer.type !== question.type) {
      problems.push(`${id}: expected a ${question.type} answer, got ${answer.type}`);
      continue;
    }
    switch (answer.type) {
      case "noul":
        if (!isProbability(answer.noul)) problems.push(`${id}: noul is outside 0..1`);
        break;
      case "choice":
        if (question.type === "choice" && !(answer.choice in question.criteria)) {
          problems.push(`${id}: choice "${answer.choice}" is not one of the requested options`);
        }
        if (!isProbability(answer.confidence)) problems.push(`${id}: confidence is outside 0..1`);
        if (!allProbabilities(answer.probabilities)) {
          problems.push(`${id}: probabilities must be within 0..1`);
        }
        break;
      case "score": {
        const maxLevel = question.type === "score" ? question.criteria.length - 1 : 0;
        if (!Number.isFinite(answer.score) || answer.score < 0 || answer.score > maxLevel) {
          problems.push(`${id}: score is outside 0..${maxLevel}`);
        }
        if (!isProbability(answer.confidence)) problems.push(`${id}: confidence is outside 0..1`);
        if (!allProbabilities(answer.probabilities)) {
          problems.push(`${id}: probabilities must be within 0..1`);
        }
        break;
      }
    }
  }

  return problems;
}

/** Provider-independent JEV operations used by the MCP tool layer. */
export class JevCore {
  readonly #defaultProviderName: string;
  readonly #providers: ReadonlyMap<string, JevProviderEntry>;
  readonly #loadImageFile: ImageFileLoader | undefined;
  readonly #maxInputChars: number;
  readonly #maxConcurrency: number;
  readonly #logger: Logger;

  constructor(options: JevCoreOptions) {
    this.#logger = options.logger ?? silentLogger;
    this.#defaultProviderName = options.providerName ?? "default";
    const providers = new Map<string, JevProviderEntry>([
      [this.#defaultProviderName, { provider: options.provider, defaultModel: options.defaultModel }],
    ]);
    for (const [name, entry] of Object.entries(options.additionalProviders ?? {})) {
      if (!providers.has(name)) providers.set(name, entry);
    }
    this.#providers = providers;
    this.#loadImageFile = options.loadImageFile;
    this.#maxInputChars = options.maxInputChars ?? 0;
    this.#maxConcurrency = Math.max(1, options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY);
  }

  /** Provider names clients may pass as `provider`, the default first. */
  get providerNames(): string[] {
    return [...this.#providers.keys()];
  }

  get defaultProviderName(): string {
    return this.#defaultProviderName;
  }

  /**
   * Lists the models of one provider, or of every provider, tagged with the provider
   * name. A provider that fails is reported in `errors`; the call fails only when
   * every requested provider fails.
   */
  async models(options?: JevRequestOptions, providerName?: string): Promise<JevModelList> {
    const names = providerName === undefined ? this.providerNames : [this.#entry(providerName).name];
    const settled = await Promise.allSettled(
      names.map((name) => this.#providers.get(name)!.provider.models(options)),
    );
    const models: JevModelList["models"] = [];
    const errors: NonNullable<JevModelList["errors"]> = [];
    let firstFailure: unknown;
    for (const [index, outcome] of settled.entries()) {
      const name = names[index]!;
      if (outcome.status === "fulfilled") {
        models.push(...outcome.value.models.map((model) => ({ ...model, provider: name })));
        continue;
      }
      // Unexpected errors (not provider errors) are never turned into a partial list.
      if (!(outcome.reason instanceof JevError)) throw outcome.reason;
      firstFailure ??= outcome.reason;
      errors.push({ provider: name, kind: outcome.reason.kind, message: outcome.reason.message });
    }
    if (errors.length === names.length) throw firstFailure;
    return { models, ...(errors.length > 0 && { errors }) };
  }

  /** Resolves a provider name; unknown names are rejected with the available ones. */
  #entry(name: string | undefined): JevProviderEntry & { name: string } {
    const resolved = name ?? this.#defaultProviderName;
    const entry = this.#providers.get(resolved);
    if (entry === undefined) {
      throw new JevError(
        "invalid_input",
        `Unknown provider "${resolved}"; this server offers: ${this.providerNames.join(", ")} (JEV_PROVIDERS adds more)`,
      );
    }
    return { ...entry, name: resolved };
  }

  /** Validates untrusted input, resolves the model and checks the provider's answers. */
  async evaluate(input: unknown, options?: JevRequestOptions): Promise<JevEvaluateResult> {
    const parsed = jevEvaluateInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new JevError("invalid_input", `Invalid evaluate input: ${formatIssues(parsed.error.issues)}`, {
        details: parsed.error.issues,
      });
    }
    return this.#send(await this.#prepare(parsed.data), options);
  }

  /**
   * Asks the same questions about each item, one provider request per item, with at
   * most `maxConcurrency` requests at a time. Every item is validated before any
   * request is sent. Each item gets its own answers or error; nothing is filled in.
   */
  async evaluateBatch(input: unknown, options?: JevRequestOptions): Promise<JevBatchResult> {
    const parsed = jevEvaluateBatchInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new JevError("invalid_input", `Invalid batch input: ${formatIssues(parsed.error.issues)}`, {
        details: parsed.error.issues,
      });
    }
    const { items, model, questions, provider } = parsed.data;

    const prepared: Prepared[] = [];
    for (const [index, item] of items.entries()) {
      try {
        prepared.push(
          await this.#prepare({
            state: item.state,
            questions,
            ...(model !== undefined && { model }),
            ...(provider !== undefined && { provider }),
            ...(item.images !== undefined && { images: item.images }),
          }),
        );
      } catch (error) {
        if (!(error instanceof JevError)) throw error;
        throw new JevError(error.kind, `items[${index}]: ${error.message}`, { details: error.details });
      }
    }

    const results = await this.#runBatch(items, prepared, options);
    const summary = { ok: 0, error: 0, skipped: 0 };
    for (const result of results) summary[result.status] += 1;
    return { provider: this.#entry(provider).name, results, summary, usage: totalBatchUsage(results) };
  }

  async #runBatch(
    items: readonly JevBatchItem[],
    requests: readonly Prepared[],
    options: JevRequestOptions | undefined,
  ): Promise<JevBatchItemResult[]> {
    const results: JevBatchItemResult[] = new Array(requests.length);
    // Cancels requests still in flight when the batch fails as a whole.
    const failed = new AbortController();
    const signal = options?.signal ? AbortSignal.any([options.signal, failed.signal]) : failed.signal;
    let next = 0;
    let stopReason: string | undefined;

    const worker = async (): Promise<void> => {
      while (next < requests.length && !failed.signal.aborted) {
        const index = next++;
        const request = requests[index]!;
        const item = { index, ...(items[index]!.id !== undefined && { id: items[index]!.id }) };
        if (stopReason !== undefined) {
          results[index] = { ...item, status: "skipped", reason: stopReason };
          continue;
        }
        try {
          const { model, answers, usage } = await this.#send(request, { signal });
          results[index] = { ...item, status: "ok", model, answers, usage };
        } catch (error) {
          if (!(error instanceof JevError)) {
            // Cancellation or an unexpected failure: no partial batch result.
            failed.abort(error);
            throw error;
          }
          results[index] = {
            ...item,
            status: "error",
            error: {
              kind: error.kind,
              message: error.message,
              ...(error.status !== undefined && { status: error.status }),
            },
          };
          if (BATCH_STOPPING_ERROR_KINDS.has(error.kind)) {
            stopReason ??= `Not sent: items[${index}] failed with ${error.kind}, which every remaining item would also hit`;
          }
        }
      }
    };

    const workers = Math.min(this.#maxConcurrency, requests.length);
    await Promise.all(Array.from({ length: workers }, worker));
    return results;
  }

  /** Checks everything that can be checked locally and builds the provider request. */
  async #prepare(input: JevEvaluateInput): Promise<Prepared> {
    const entry = this.#entry(input.provider);
    const model = input.model ?? entry.defaultModel;
    if (model === undefined) {
      throw new JevError(
        "invalid_input",
        `Invalid evaluate input: model is required when provider is ${entry.name}; jev.models lists its models`,
      );
    }
    if (this.#maxInputChars > 0) {
      const size = JSON.stringify({ state: input.state, questions: input.questions }).length;
      if (size > this.#maxInputChars) {
        throw new JevError(
          "invalid_input",
          `Invalid evaluate input: text input is ${size} characters; the limit is ${this.#maxInputChars} (JEV_MAX_INPUT_CHARS). Shorten state or raise the limit.`,
        );
      }
    }
    if (containsImagePart(input.state)) {
      throw new JevError(
        "invalid_input",
        "Invalid evaluate input: state contains an image part; pass images in the images field instead",
      );
    }
    const images = input.images ? await this.#resolveImages(input.images) : undefined;
    return { providerName: entry.name, provider: entry.provider, request: this.#toRequest(input, model, images) };
  }

  /** Sends one request and rejects answers that do not match the questions asked. */
  async #send({ providerName, provider, request }: Prepared, options?: JevRequestOptions): Promise<JevEvaluateResult> {
    const started = Date.now();
    const subject = `evaluate provider=${providerName} model=${request.model} questions=${Object.keys(request.questions).length} images=${request.images?.length ?? 0}`;
    try {
      const result = await provider.evaluate(request, options);
      const problems = findAnswerProblems(request, result);
      if (problems.length > 0) {
        throw new JevError(
          "invalid_response",
          `Provider answers do not match the questions: ${problems.join("; ")}`,
          { details: { problems, result } },
        );
      }
      const { inputTokens, outputTokens, costUsd } = result.usage;
      this.#logger.debug(
        `${subject} ok in ${Date.now() - started} ms (answered by ${result.model}, tokens ${inputTokens}/${outputTokens}${costUsd !== undefined ? `, cost ${costUsd} USD` : ""})`,
      );
      return { ...result, provider: providerName };
    } catch (error) {
      if (error instanceof JevError) {
        this.#logger.debug(`${subject} failed in ${Date.now() - started} ms with ${error.kind}`);
        // The tool result carries only the message; the provider's payload is kept for diagnosis here.
        if (error.kind === "invalid_response") {
          this.#logger.warn(`Invalid provider response: ${error.message}. Provider payload: ${excerpt(error.details)}`);
        }
      }
      throw error;
    }
  }

  async #resolveImages(sources: readonly JevImageSource[]): Promise<JevImage[]> {
    const images: JevImage[] = [];
    for (const [index, source] of sources.entries()) {
      const label = `images[${index}]`;
      if ("data" in source) {
        images.push(imageFromDataUrl(source.data, label));
        continue;
      }
      if (this.#loadImageFile === undefined) {
        throw new JevError(
          "invalid_input",
          `${label}: image paths are disabled on this server; set JEV_IMAGE_DIRS or pass data instead`,
        );
      }
      images.push(imageFromBytes(await this.#loadImageFile(source.path), label));
    }
    checkImageSet(images);
    return images;
  }

  #toRequest(input: JevEvaluateInput, model: string, images: JevImage[] | undefined): JevEvaluateRequest {
    return {
      state: input.state,
      model,
      questions: input.questions,
      ...(images !== undefined && { images }),
    };
  }
}
