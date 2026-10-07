import { describe, expect, it, vi } from "vitest";
import { JevError } from "../../src/core/errors.js";
import { TypeSafeProvider } from "../../src/providers/typesafe/typesafe-provider.js";

const API_KEY = "test-api-key";
const BASE_URL = "https://api.example.test/";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function providerWith(fetchImpl: typeof fetch, timeoutMs?: number): TypeSafeProvider {
  return new TypeSafeProvider({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    fetch: fetchImpl,
    ...(timeoutMs !== undefined && { timeoutMs }),
  });
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

describe("TypeSafeProvider.models", () => {
  it("sends an authenticated GET to /v1/models and maps the documented response", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        models: [
          {
            name: "jev-latest",
            description: "General-purpose system one model.",
            release_date: "2026-09-15",
          },
        ],
      }),
    );

    const result = await providerWith(fetchMock).models();

    expect(result).toEqual({
      models: [
        {
          name: "jev-latest",
          description: "General-purpose system one model.",
          releaseDate: "2026-09-15",
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.example.test/v1/models");
    expect(init?.method).toBe("GET");
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` });
  });

  it("accepts an empty model list", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ models: [] }));
    await expect(providerWith(fetchMock).models()).resolves.toEqual({ models: [] });
  });

  it("rejects a response missing required fields instead of filling them in", async () => {
    const body = { models: [{ name: "jev-latest", description: "x" }] };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body));

    const error = await captureError(providerWith(fetchMock).models());

    expect(error.kind).toBe("invalid_response");
    expect(error.details).toMatchObject({ body });
  });

  it("rejects a non-JSON success response", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("<html>gateway</html>", { status: 200 }));

    const error = await captureError(providerWith(fetchMock).models());

    expect(error.kind).toBe("invalid_response");
    expect(error.details).toBe("<html>gateway</html>");
  });

  it.each([
    {
      status: 401,
      body: {
        detail: {
          error_type: "authentication_error",
          message: "Cannot authenticate with the server. Please check your API key and try again.",
        },
      },
      kind: "authentication",
      providerCode: "authentication_error",
    },
    {
      // Observed for a missing API key; the docs list 401 for this case.
      status: 403,
      body: {
        detail: {
          error_type: "authentication_error",
          message: "Must supply an API key! Check your request and try again.",
        },
      },
      kind: "authentication",
      providerCode: "authentication_error",
    },
    { status: 403, body: { detail: { message: "Forbidden" } }, kind: "authorization" },
    {
      status: 422,
      body: { detail: [{ loc: ["query", "x"], msg: "Field required", type: "missing" }] },
      kind: "invalid_request",
    },
    { status: 429, body: {}, kind: "rate_limited" },
    { status: 529, body: {}, kind: "overloaded" },
    { status: 500, body: {}, kind: "provider_error" },
  ])("maps HTTP $status to $kind", async ({ status, body, kind, providerCode }) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body, { status }));

    const error = await captureError(providerWith(fetchMock).models());

    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
    expect(error.providerCode).toBe(providerCode);
    expect(error.details).toEqual(body);
  });

  it("includes the provider's message and validation locations in the error message", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        { detail: [{ loc: ["body", "state"], msg: "Field required", type: "missing" }] },
        { status: 422 },
      ),
    );

    const error = await captureError(providerWith(fetchMock).models());

    expect(error.message).toBe("TypeSafe API returned HTTP 422: body.state: Field required");
  });

  it("exposes retry-after seconds on rate limiting", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({}, { status: 429, headers: { "retry-after": "7" } }));

    const error = await captureError(providerWith(fetchMock).models());

    expect(error.retryAfterSeconds).toBe(7);
  });

  it("keeps a non-JSON error body as text", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("Bad Gateway", { status: 502 }));

    const error = await captureError(providerWith(fetchMock).models());

    expect(error.kind).toBe("provider_error");
    expect(error.message).toBe("TypeSafe API returned HTTP 502");
    expect(error.details).toBe("Bad Gateway");
  });

  it("never includes the API key in error messages or details", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ detail: { error_type: "authentication_error", message: "no" } }, {
        status: 401,
      }),
    );

    const error = await captureError(providerWith(fetchMock).models());

    expect(error.message).not.toContain(API_KEY);
    expect(JSON.stringify(error.details)).not.toContain(API_KEY);
  });

  it("maps fetch failures to a network error that names the underlying cause", async () => {
    const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("fetch failed", { cause: reset }));

    const error = await captureError(providerWith(fetchMock).models());

    expect(error.kind).toBe("network");
    expect(error.message).toBe("Could not reach the TypeSafe API (ECONNRESET: read ECONNRESET)");
    expect(error.cause).toBeInstanceOf(TypeError);
  });

  it("maps its own timeout to a timeout error", async () => {
    const fetchMock = vi.fn<typeof fetch>((_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
    );

    const error = await captureError(providerWith(fetchMock, 10).models());

    expect(error.kind).toBe("timeout");
  });

  it("propagates caller cancellation unchanged", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>((_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
    );

    const pending = providerWith(fetchMock).models({ signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.not.toBeInstanceOf(JevError);
  });
});

describe("TypeSafeProvider.evaluate", () => {
  const request = {
    state: { ticket: "Help! My payouts have been failing for 3 days." },
    model: "jev-latest",
    questions: {
      is_urgent: { type: "noul" as const, instructions: "Does this convey urgency?" },
      frustration: {
        type: "score" as const,
        instructions: "How frustrated is the customer?",
        criteria: ["Calm", "Frustrated", "Very angry"],
      },
    },
  };

  const wireResponse = {
    model: "jev-1.13.0",
    answers: {
      is_urgent: { type: "noul", noul: 0.95 },
      frustration: {
        type: "score",
        score: 1.05,
        legend: { "0": "Calm", "1": "Frustrated", "2": "Very angry" },
        probabilities: { "0": 0.0, "1": 0.95, "2": 0.05 },
        confidence: 0.92,
      },
    },
    usage: { input_tokens: 296, output_tokens: 20 },
  };

  it("POSTs the request as JSON to /v1/systemone", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(wireResponse));

    await providerWith(fetchMock).evaluate(request);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.example.test/v1/systemone");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init?.body as string)).toEqual(request);
  });

  it("maps the documented response, including usage", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(wireResponse));

    const result = await providerWith(fetchMock).evaluate(request);

    expect(result).toEqual({
      model: "jev-1.13.0",
      answers: wireResponse.answers,
      usage: { inputTokens: 296, outputTokens: 20 },
    });
  });

  it("maps a choice answer", async () => {
    const answer = {
      type: "choice",
      choice: "billing",
      probabilities: { billing: 0.88, technical: 0.12 },
      confidence: 0.81,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ ...wireResponse, answers: { department: answer } }));

    const result = await providerWith(fetchMock).evaluate(request);

    expect(result.answers).toEqual({ department: answer });
  });

  it.each([
    ["missing usage", { model: "m", answers: wireResponse.answers }],
    ["unknown answer type", { ...wireResponse, answers: { q: { type: "rank", rank: 1 } } }],
    ["noul without a value", { ...wireResponse, answers: { q: { type: "noul" } } }],
    [
      "choice without confidence",
      { ...wireResponse, answers: { q: { type: "choice", choice: "a", probabilities: {} } } },
    ],
    ["non-integer token counts", { ...wireResponse, usage: { input_tokens: 1.5, output_tokens: 0 } }],
  ])("rejects a response with %s", async (_label, body) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body));

    const error = await captureError(providerWith(fetchMock).evaluate(request));

    expect(error.kind).toBe("invalid_response");
    expect(error.details).toMatchObject({ body });
  });

  it("maps a 422 validation error with field locations", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          detail: [
            {
              loc: ["body", "questions", "frustration", "score", "criteria"],
              msg: "List should have at least 1 item after validation, not 0",
              type: "too_short",
            },
          ],
        },
        { status: 422 },
      ),
    );

    const error = await captureError(providerWith(fetchMock).evaluate(request));

    expect(error.kind).toBe("invalid_request");
    expect(error.message).toContain("body.questions.frustration.score.criteria");
  });
});
