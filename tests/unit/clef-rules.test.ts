import { describe, expect, it } from "vitest";
import { JevError } from "../../src/core/errors.js";
import type { JevEvaluateRequest } from "../../src/core/provider.js";
import { assertClefRequestRules, isClefModel } from "../../src/providers/openrouter/clef-rules.js";

const noul = { type: "noul" as const, instructions: "Is it urgent?" };

function request(questions: JevEvaluateRequest["questions"]): JevEvaluateRequest {
  return { state: "x", model: "cloudflare/clef-flash", questions };
}

function problem(questions: JevEvaluateRequest["questions"]): string {
  try {
    assertClefRequestRules(request(questions));
  } catch (error) {
    expect(error).toBeInstanceOf(JevError);
    expect((error as JevError).kind).toBe("invalid_input");
    return (error as JevError).message;
  }
  throw new Error("expected a rule violation");
}

describe("isClefModel", () => {
  it.each([
    ["cloudflare/clef", true],
    ["cloudflare/clef-flash", true],
    ["cloudflare/clef-flash:free", true],
    ["cloudflare/clefx", false],
    ["typesafe/jev-1.13", false],
    ["jev-latest", false],
  ])("%s -> %s", (model, expected) => {
    expect(isClefModel(model)).toBe(expected);
  });
});

describe("assertClefRequestRules", () => {
  it("accepts a request within Clef's rules", () => {
    const questions = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`q.${i}_ok-${i}`, noul]));
    expect(() => assertClefRequestRules(request(questions))).not.toThrow();
  });

  it("rejects question IDs with characters Clef does not allow, naming them", () => {
    expect(problem({ "긴급도": noul, "needs review": noul, ok: noul })).toBe(
      'Model cloudflare/clef-flash does not accept this request: question IDs may only use letters, digits, "_", "." and "-" (up to 100 characters): "긴급도", "needs review"',
    );
  });

  it("rejects question IDs longer than 100 characters", () => {
    expect(problem({ ["a".repeat(101)]: noul })).toContain("up to 100 characters");
  });

  it("rejects more than 64 questions", () => {
    const questions = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`q${i}`, noul]));
    expect(problem(questions)).toContain("at most 64 questions per request, got 65");
  });

  it("rejects a choice with a single option", () => {
    expect(
      problem({ team: { type: "choice", instructions: "Which team?", criteria: { billing: null } } }),
    ).toContain("team: a choice needs at least 2 options");
  });

  it("reports every problem at once", () => {
    const message = problem({
      "팀": { type: "choice", instructions: "Which team?", criteria: { billing: null } },
    });
    expect(message).toContain("question IDs may only use");
    expect(message).toContain("팀: a choice needs at least 2 options");
  });
});
