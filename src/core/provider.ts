import type { JevDescription, JevQuestion } from "../schemas/evaluate.js";

/** A model or alias the provider accepts in an evaluation request. */
export interface JevModel {
  name: string;
  description: string;
  /** Release date as reported by the provider; format varies (see docs/typesafe-api-notes.md). */
  releaseDate: string;
}

export interface JevModelList {
  models: JevModel[];
}

export interface JevRequestOptions {
  signal?: AbortSignal;
}

/** A validated evaluation request with the model already resolved. */
export interface JevEvaluateRequest {
  state: JevDescription;
  model: string;
  questions: Record<string, JevQuestion>;
}

export interface JevNoulAnswer {
  type: "noul";
  /** Probability of yes, 0 to 1. */
  noul: number;
}

export interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface JevScoreAnswer {
  type: "score";
  /** Probability-weighted level, 0 to (levels - 1). */
  score: number;
  confidence: number;
  legend: Record<string, JevDescription>;
  probabilities: Record<string, number>;
}

export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer;

export interface JevUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface JevEvaluateResult {
  /** The model that answered; may be a versioned ID when an alias was requested. */
  model: string;
  answers: Record<string, JevAnswer>;
  usage: JevUsage;
}

/** Provider-neutral interface that JEV Core depends on. */
export interface JevProvider {
  models(options?: JevRequestOptions): Promise<JevModelList>;
  evaluate(request: JevEvaluateRequest, options?: JevRequestOptions): Promise<JevEvaluateResult>;
}
