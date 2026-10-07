import type { z } from "zod";
import type { ImageFileLoader } from "../images/directory-image-loader.js";
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
import { JevError } from "./errors.js";
import type {
  JevEvaluateRequest,
  JevEvaluateResult,
  JevImage,
  JevModelList,
  JevProvider,
  JevRequestOptions,
} from "./provider.js";

export interface JevCoreOptions {
  provider: JevProvider;
  /** Used when an evaluate input does not name a model. */
  defaultModel: string;
  /** Reads `images[].path` entries. Without it, image paths are rejected. */
  loadImageFile?: ImageFileLoader;
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
  readonly #provider: JevProvider;
  readonly #defaultModel: string;
  readonly #loadImageFile: ImageFileLoader | undefined;

  constructor(options: JevCoreOptions) {
    this.#provider = options.provider;
    this.#defaultModel = options.defaultModel;
    this.#loadImageFile = options.loadImageFile;
  }

  models(options?: JevRequestOptions): Promise<JevModelList> {
    return this.#provider.models(options);
  }

  /** Validates untrusted input, resolves the model and checks the provider's answers. */
  async evaluate(input: unknown, options?: JevRequestOptions): Promise<JevEvaluateResult> {
    const parsed = jevEvaluateInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new JevError("invalid_input", `Invalid evaluate input: ${formatIssues(parsed.error.issues)}`, {
        details: parsed.error.issues,
      });
    }

    if (containsImagePart(parsed.data.state)) {
      throw new JevError(
        "invalid_input",
        "Invalid evaluate input: state contains an image part; pass images in the images field instead",
      );
    }
    const images = parsed.data.images ? await this.#resolveImages(parsed.data.images) : undefined;

    const request = this.#toRequest(parsed.data, images);
    const result = await this.#provider.evaluate(request, options);

    const problems = findAnswerProblems(request, result);
    if (problems.length > 0) {
      throw new JevError(
        "invalid_response",
        `Provider answers do not match the questions: ${problems.join("; ")}`,
        { details: { problems, result } },
      );
    }
    return result;
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

  #toRequest(input: JevEvaluateInput, images: JevImage[] | undefined): JevEvaluateRequest {
    return {
      state: input.state,
      model: input.model ?? this.#defaultModel,
      questions: input.questions,
      ...(images !== undefined && { images }),
    };
  }
}
