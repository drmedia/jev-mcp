import { describe, expect, it } from "vitest";
import { jevEvaluateInputSchema } from "../../src/schemas/evaluate.js";

const validInput = {
  state: "Help! My payouts have been failing for 3 days.",
  questions: {
    is_urgent: {
      type: "noul",
      instructions: "Does this convey urgency?",
      criteria: { true: "Explicitly time-sensitive", false: "No urgency expressed" },
    },
    department: {
      type: "choice",
      instructions: "Which team should handle this?",
      criteria: { billing: "Payments, invoicing, refunds", technical: null },
    },
    frustration: {
      type: "score",
      instructions: { question: "How frustrated is the customer?" },
      criteria: ["Calm", "Frustrated", "Very angry"],
    },
  },
};

function issuesFor(input: unknown): string[] {
  const result = jevEvaluateInputSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

describe("jevEvaluateInputSchema", () => {
  it("accepts all three question types, with structured state", () => {
    expect(issuesFor(validInput)).toEqual([]);
    expect(issuesFor({ ...validInput, state: { ticket: { text: "hi" } } })).toEqual([]);
    expect(issuesFor({ ...validInput, state: ["a", "b"] })).toEqual([]);
  });

  it("accepts an optional model and rejects an empty one", () => {
    expect(issuesFor({ ...validInput, model: "jev-1.13.0" })).toEqual([]);
    expect(issuesFor({ ...validInput, model: " " })).toEqual(["model: must not be empty"]);
  });

  it.each([
    ["missing state", { questions: validInput.questions }],
    ["numeric state", { ...validInput, state: 42 }],
    ["no questions", { ...validInput, questions: {} }],
    ["unknown top-level field", { ...validInput, temperature: 0.5 }],
    ["unknown question type", { ...validInput, questions: { q: { type: "rank", instructions: "x" } } }],
    ["missing instructions", { ...validInput, questions: { q: { type: "noul" } } }],
    [
      "unknown question field",
      { ...validInput, questions: { q: { type: "noul", instructions: "x", weight: 2 } } },
    ],
    [
      "choice without options",
      { ...validInput, questions: { q: { type: "choice", instructions: "x", criteria: {} } } },
    ],
    [
      "score with one level",
      { ...validInput, questions: { q: { type: "score", instructions: "x", criteria: ["only"] } } },
    ],
    [
      "score with eleven levels",
      {
        ...validInput,
        questions: {
          q: { type: "score", instructions: "x", criteria: Array.from({ length: 11 }, String) },
        },
      },
    ],
  ])("rejects %s", (_label, input) => {
    expect(issuesFor(input).length).toBeGreaterThan(0);
  });

  it("rejects more than 255 choice options", () => {
    const criteria = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`o${i}`, null]));
    const issues = issuesFor({
      ...validInput,
      questions: { q: { type: "choice", instructions: "x", criteria } },
    });
    expect(issues).toEqual(["questions.q.criteria: must define at most 255 options"]);
  });
});
