import type { JevErrorKind } from "./errors.js";
import type { JevAnswer, JevUsage } from "./provider.js";

interface JevBatchItemBase {
  /** Position of the item in the input. */
  index: number;
  /** The item's `id`, when the input gave one. */
  id?: string;
}

export interface JevBatchItemSuccess extends JevBatchItemBase {
  status: "ok";
  model: string;
  answers: Record<string, JevAnswer>;
  usage: JevUsage;
}

export interface JevBatchItemFailure extends JevBatchItemBase {
  status: "error";
  error: { kind: JevErrorKind; message: string; status?: number };
}

/** An item that was never sent because an earlier failure would also have hit it. */
export interface JevBatchItemSkipped extends JevBatchItemBase {
  status: "skipped";
  reason: string;
}

export type JevBatchItemResult = JevBatchItemSuccess | JevBatchItemFailure | JevBatchItemSkipped;

export interface JevBatchResult {
  /** One entry per input item, in input order. */
  results: JevBatchItemResult[];
  summary: { ok: number; error: number; skipped: number };
  /** Sum over successful items. `costUsd` is present only when every successful item reported one. */
  usage: JevUsage;
}

/**
 * Errors every remaining item would also hit. After one of these, items not yet
 * sent are skipped instead of being billed or rejected one by one.
 */
export const BATCH_STOPPING_ERROR_KINDS: ReadonlySet<JevErrorKind> = new Set([
  "configuration",
  "authentication",
  "authorization",
  "payment_required",
]);

/** Adds up the usage of successful items without estimating anything that was not reported. */
export function totalBatchUsage(results: readonly JevBatchItemResult[]): JevUsage {
  const successes = results.filter((result): result is JevBatchItemSuccess => result.status === "ok");
  const usage: JevUsage = {
    inputTokens: successes.reduce((sum, result) => sum + result.usage.inputTokens, 0),
    outputTokens: successes.reduce((sum, result) => sum + result.usage.outputTokens, 0),
  };
  if (successes.length > 0 && successes.every((result) => result.usage.costUsd !== undefined)) {
    usage.costUsd = successes.reduce((sum, result) => sum + (result.usage.costUsd ?? 0), 0);
  }
  return usage;
}
