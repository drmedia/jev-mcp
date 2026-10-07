import { describe, expect, it, vi } from "vitest";
import { JevError } from "../../src/core/errors.js";
import { parseOpenRouterErrorBody } from "../../src/providers/openrouter/error-body.js";
import {
  DEFAULT_OPENROUTER_BASE_URL,
  OpenRouterProvider,
} from "../../src/providers/openrouter/openrouter-provider.js";

const API_KEY = "sk-or-test-key";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function providerWith(fetchImpl: typeof fetch): OpenRouterProvider {
  return new OpenRouterProvider({ apiKey: API_KEY, fetch: fetchImpl });
}

async function captureError(promise: Promise<unknown>): Promise<JevError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(JevError);
    return error as JevError;
  }
  throw new Error("expected promise to reject");
}

const request = {
  state: "Help! My payouts have been failing for 3 days.",
  model: "cloudflare/clef-flash",
  questions: { is_urgent: { type: "noul" as const, instructions: "Does this convey urgency?" } },
};

// Shape observed from the live API on 2026-10-07.
const wireResponse = {
  model: "cloudflare/clef-flash",
  answers: { is_urgent: { type: "noul", noul: 0.8456 } },
  usage: { input_tokens: 338, output_tokens: 0, cost: 0.00003042 },
  id: "gen-dec-1791361179-s3nRo2fyHUmwBb9iaXBn",
  provider: "Cloudflare",
};

describe("OpenRouterProvider.evaluate", () => {
  it("POSTs the System One request to https://openrouter.ai/api/v1/systemone", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(wireResponse));

    await providerWith(fetchMock).evaluate(request);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(DEFAULT_OPENROUTER_BASE_URL).toBe("https://openrouter.ai/api");
    expect(url).toBe("https://openrouter.ai/api/v1/systemone");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` });
    expect(JSON.parse(init?.body as string)).toEqual(request);
  });

  it("maps answers and the provider-reported cost, dropping OpenRouter-only fields", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(wireResponse));

    await expect(providerWith(fetchMock).evaluate(request)).resolves.toEqual({
      model: "cloudflare/clef-flash",
      answers: { is_urgent: { type: "noul", noul: 0.8456 } },
      usage: { inputTokens: 338, outputTokens: 0, costUsd: 0.00003042 },
    });
  });

  it("omits the cost when the response does not report one", async () => {
    const { cost: _cost, ...usage } = wireResponse.usage;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ ...wireResponse, usage }));

    const result = await providerWith(fetchMock).evaluate(request);

    expect(result.usage).toEqual({ inputTokens: 338, outputTokens: 0 });
  });

  it("rejects a negative cost instead of passing it through", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ ...wireResponse, usage: { ...wireResponse.usage, cost: -1 } }),
    );

    const error = await captureError(providerWith(fetchMock).evaluate(request));

    expect(error.kind).toBe("invalid_response");
    expect(error.message).toBe("OpenRouter System One response failed validation");
  });

  it.each([
    [400, "Model cloudflare/no-such-model does not exist", "invalid_request"],
    [401, "Missing Authentication header", "authentication"],
    [402, "Insufficient credits. Add more using https://openrouter.ai/credits", "payment_required"],
    [403, "Key is disabled", "authorization"],
    [422, "HTTP 422: upstream validation failed", "invalid_request"],
    [429, "Rate limit exceeded", "rate_limited"],
    [502, "Provider returned error", "provider_error"],
    [524, "Request timed out. Please try again later.", "timeout"],
    [529, "Provider overloaded", "overloaded"],
  ] as const)("maps HTTP %i to %s with OpenRouter's message", async (status, message, kind) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ error: { message, code: status }, user_id: "user_secret" }, { status }),
    );

    const error = await captureError(providerWith(fetchMock).evaluate(request));

    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
    expect(error.message).toBe(`OpenRouter API returned HTTP ${status}: ${message}`);
    expect(JSON.stringify(error.details)).not.toContain("user_secret");
    expect(error.message).not.toContain(API_KEY);
  });

  it("names OpenRouter in network errors", async () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND openrouter.ai"), {
      code: "ENOTFOUND",
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("fetch failed", { cause }));

    const error = await captureError(providerWith(fetchMock).evaluate(request));

    expect(error.kind).toBe("network");
    expect(error.message).toBe(
      "Could not reach the OpenRouter API (ENOTFOUND: getaddrinfo ENOTFOUND openrouter.ai)",
    );
  });
});

describe("OpenRouterProvider.models", () => {
  const modelList = {
    data: [
      {
        id: "cloudflare/clef-flash",
        name: "Cloudflare: Clef Flash",
        description: "Fast 9B decision model.",
        created: 1790870972,
        architecture: { output_modalities: ["decisions"] },
      },
      {
        id: "typesafe/jev-1.13",
        name: "TypeSafe: Jev 1.13",
        description: "System One decision model.",
        created: 1789776000,
        architecture: { output_modalities: ["decisions"] },
      },
      {
        id: "some/chat-model",
        name: "Chat",
        description: "Not a decision model.",
        created: 1789776000,
        architecture: { output_modalities: ["text"] },
      },
    ],
  };

  it("lists decision models only, with ISO release dates", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(modelList));

    const result = await providerWith(fetchMock).models();

    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://openrouter.ai/api/v1/models?output_modalities=decisions",
    );
    expect(result).toEqual({
      models: [
        { name: "cloudflare/clef-flash", description: "Fast 9B decision model.", releaseDate: "2026-10-01" },
        { name: "typesafe/jev-1.13", description: "System One decision model.", releaseDate: "2026-09-19" },
      ],
    });
  });

  it("rejects an unexpected model list shape", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ models: [{ name: "x" }] }));

    const error = await captureError(providerWith(fetchMock).models());

    expect(error.kind).toBe("invalid_response");
  });
});

describe("parseOpenRouterErrorBody", () => {
  it("flattens JSON-encoded validation issues", () => {
    const message = JSON.stringify([
      { code: "invalid_type", path: ["questions"], message: "Invalid input: expected record" },
    ]);

    expect(parseOpenRouterErrorBody(JSON.stringify({ error: { message, code: 400 } }))).toEqual({
      message: "questions: Invalid input: expected record",
      providerCode: undefined,
      details: { error: { code: 400, message: "questions: Invalid input: expected record" } },
    });
  });

  it("truncates very long messages", () => {
    const parsed = parseOpenRouterErrorBody(
      JSON.stringify({ error: { message: "x".repeat(2000), code: 422 } }),
    );

    expect(parsed.message?.length).toBe(501);
    expect(parsed.message?.endsWith("…")).toBe(true);
  });

  it("keeps non-JSON bodies as truncated text", () => {
    expect(parseOpenRouterErrorBody("Bad Gateway").details).toBe("Bad Gateway");
  });
});
