import type { z } from "zod";
import { jevEvaluateInputSchema, type JevEvaluateInput } from "../schemas/evaluate.js";
import { JevError } from "./errors.js";
import type {
  JevEvaluateRequest,
  JevEvaluateResult,
  JevModelList,
  JevProvider,
  JevRequestOptions,
} from "./provider.js";

export interface JevCoreOptions {
  provider: JevProvider;
  /** Used when an evaluate input does not name a model. */
  defaultModel: string;
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

  constructor(options: JevCoreOptions) {
    this.#provider = options.provider;
    this.#defaultModel = options.defaultModel;
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

    const request = this.#toRequest(parsed.data);
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

  #toRequest(input: JevEvaluateInput): JevEvaluateRequest {
    return {
      state: input.state,
      model: input.model ?? this.#defaultModel,
      questions: input.questions,
    };
  }
}
