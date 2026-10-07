/** A model or alias the provider accepts in an evaluation request. */
export interface JevModel {
  name: string;
  description: string;
  /** Release date as reported by the provider (TypeSafe documents YYYY-MM-DD). */
  releaseDate: string;
}

export interface JevModelList {
  models: JevModel[];
}

export interface JevRequestOptions {
  signal?: AbortSignal;
}

/**
 * Provider-neutral interface that JEV Core depends on.
 * `evaluate` is added in MVP Phase 2.
 */
export interface JevProvider {
  models(options?: JevRequestOptions): Promise<JevModelList>;
}
