import type {
  JevEvaluateRequest,
  JevEvaluateResult,
  JevModelList,
  JevProvider,
} from "../../src/core/provider.js";

type EvaluateHandler = (request: JevEvaluateRequest) => JevEvaluateResult | Promise<JevEvaluateResult>;

/** Test double implementing the same interface as TypeSafeProvider. */
export class MockJevProvider implements JevProvider {
  readonly evaluateCalls: JevEvaluateRequest[] = [];

  constructor(
    private readonly handlers: {
      evaluate?: EvaluateHandler;
      models?: () => JevModelList | Promise<JevModelList>;
    } = {},
  ) {}

  async models(): Promise<JevModelList> {
    if (!this.handlers.models) throw new Error("MockJevProvider: models handler not set");
    return this.handlers.models();
  }

  async evaluate(request: JevEvaluateRequest): Promise<JevEvaluateResult> {
    this.evaluateCalls.push(request);
    if (!this.handlers.evaluate) throw new Error("MockJevProvider: evaluate handler not set");
    return this.handlers.evaluate(request);
  }
}
