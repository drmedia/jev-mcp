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

  it("maps fetch failures to a network error", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));

    const error = await captureError(providerWith(fetchMock).models());

    expect(error.kind).toBe("network");
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
