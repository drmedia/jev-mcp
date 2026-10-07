import { describe, expect, it, vi } from "vitest";
import { JevError } from "../../src/core/errors.js";
import { parseOpenRouterErrorBody } from "../../src/providers/openrouter/error-body.js";
import {
  DEFAULT_OPENROUTER_BASE_URL,
  OpenRouterProvider,
} from "../../src/providers/openrouter/openrouter-provider.js";
import { CLEF_MAX_TOTAL_IMAGE_BYTES } from "../../src/providers/openrouter/clef-rules.js";
import { solidPng } from "../support/images.js";

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

// Documented `Model` shape (architecture.input_modalities and output_modalities are required).
const modelList = {
  data: [
    {
      id: "cloudflare/clef-flash",
      name: "Cloudflare: Clef Flash",
      description: "Fast 9B decision model.",
      created: 1790870972,
      architecture: { input_modalities: ["text", "image"], output_modalities: ["decisions"] },
    },
    {
      id: "typesafe/jev-1.13",
      name: "TypeSafe: Jev 1.13",
      created: 1789776000,
      architecture: { input_modalities: ["text"], output_modalities: ["decisions"] },
    },
    {
      id: "openai/gpt-6-luna-decisions",
      name: "OpenAI: GPT-6 Luna Decisions",
      created: 1791244800,
      architecture: { input_modalities: ["text", "image"], output_modalities: ["decisions"] },
    },
    {
      id: "some/chat-model",
      name: "Chat",
      description: "Not a decision model.",
      created: 1789776000,
      architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
    },
  ],
};

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
    [413, "HTTP 413: estimated tokens exceeded the context window", "invalid_request"],
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
  it("lists decision models only, with ISO release dates", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(modelList));

    const result = await providerWith(fetchMock).models();

    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://openrouter.ai/api/v1/models?output_modalities=decisions",
    );
    expect(result).toEqual({
      models: [
        { name: "cloudflare/clef-flash", description: "Fast 9B decision model.", releaseDate: "2026-10-01" },
        // `description` is optional in OpenRouter's schema; `name` stands in.
        { name: "typesafe/jev-1.13", description: "TypeSafe: Jev 1.13", releaseDate: "2026-09-19" },
        {
          name: "openai/gpt-6-luna-decisions",
          description: "OpenAI: GPT-6 Luna Decisions",
          releaseDate: "2026-10-06",
        },
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

describe("OpenRouterProvider.evaluate with images", () => {
  const png = solidPng([220, 20, 20]);
  const image = { mediaType: "image/png" as const, base64: png.toString("base64"), byteLength: png.byteLength };
  const imagePart = { type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } };

  /** Answers the model list first, then the System One call. */
  function routedFetch() {
    return vi.fn<typeof fetch>(async (url) =>
      String(url).includes("/v1/models") ? jsonResponse(modelList) : jsonResponse(wireResponse),
    );
  }

  function postedBody(fetchMock: ReturnType<typeof routedFetch>): Record<string, unknown> {
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    return JSON.parse(post![1]!.body as string) as Record<string, unknown>;
  }

  it("puts images first in a state array, as OpenRouter's System One API requires", async () => {
    const fetchMock = routedFetch();

    await providerWith(fetchMock).evaluate({ ...request, images: [image] });

    expect(postedBody(fetchMock)).toEqual({
      model: "cloudflare/clef-flash",
      state: [imagePart, request.state],
      questions: request.questions,
    });
  });

  it("keeps the elements of an array state after the images", async () => {
    const fetchMock = routedFetch();

    await providerWith(fetchMock).evaluate({ ...request, state: ["a", { b: 1 }], images: [image, image] });

    expect(postedBody(fetchMock).state).toEqual([imagePart, imagePart, "a", { b: 1 }]);
  });

  it("never sends images to a model whose inputs are text only", async () => {
    const fetchMock = routedFetch();

    const error = await captureError(
      providerWith(fetchMock).evaluate({ ...request, model: "typesafe/jev-1.13", images: [image] }),
    );

    expect(error.kind).toBe("invalid_input");
    expect(error.message).toBe(
      "Model typesafe/jev-1.13 does not accept images (OpenRouter lists its inputs as: text)",
    );
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it.each(["jev-latest", "clef-flash", "some/chat-model"])(
    "rejects images for %s, which is not a listed image-capable decision model",
    async (model) => {
      const fetchMock = routedFetch();

      const error = await captureError(providerWith(fetchMock).evaluate({ ...request, model, images: [image] }));

      expect(error.kind).toBe("invalid_input");
      expect(error.message).toContain(`Model ${model} is not listed by OpenRouter`);
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    },
  );

  it("reuses the model list for 10 minutes", async () => {
    let now = 0;
    const fetchMock = routedFetch();
    const provider = new OpenRouterProvider({ apiKey: API_KEY, fetch: fetchMock, now: () => now });
    const listCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("/v1/models")).length;

    await provider.evaluate({ ...request, images: [image] });
    now += 9 * 60 * 1000;
    await provider.evaluate({ ...request, images: [image] });
    expect(listCalls()).toBe(1);

    now += 2 * 60 * 1000;
    await provider.evaluate({ ...request, images: [image] });
    expect(listCalls()).toBe(2);
  });

  it("rejects Clef image requests above the measured total before any request", async () => {
    const fetchMock = routedFetch();
    const big = { ...image, byteLength: CLEF_MAX_TOTAL_IMAGE_BYTES / 2 + 1 };

    const error = await captureError(providerWith(fetchMock).evaluate({ ...request, images: [big, big] }));

    expect(error.kind).toBe("invalid_input");
    expect(error.message).toContain(
      "images are 384 KB in total; Clef on OpenRouter rejects more than about 384 KB per request",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts Clef images exactly at the measured total", async () => {
    const fetchMock = routedFetch();
    const half = { ...image, byteLength: CLEF_MAX_TOTAL_IMAGE_BYTES / 2 };

    await expect(providerWith(fetchMock).evaluate({ ...request, images: [half, half] })).resolves.toBeDefined();
  });

  it("does not apply Clef's image total to other image-capable models", async () => {
    const fetchMock = routedFetch();
    const large = { ...image, byteLength: 624_286 };

    await providerWith(fetchMock).evaluate({ ...request, model: "openai/gpt-6-luna-decisions", images: [large] });

    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true);
  });

  it("does not fetch the model list for text-only requests", async () => {
    const fetchMock = routedFetch();

    await providerWith(fetchMock).evaluate(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("OpenRouterProvider model rules", () => {
  it("checks Clef's rules before sending anything", async () => {
    const fetchMock = vi.fn<typeof fetch>();

    const error = await captureError(
      providerWith(fetchMock).evaluate({ ...request, questions: { "긴급도": request.questions.is_urgent } }),
    );

    expect(error.kind).toBe("invalid_input");
    expect(error.message).toContain('"긴급도"');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not apply Clef's rules to other models", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ ...wireResponse, model: "typesafe/jev-1.13", answers: { "긴급도": { type: "noul", noul: 0.9 } } }),
    );

    await providerWith(fetchMock).evaluate({
      ...request,
      model: "typesafe/jev-1.13",
      questions: { "긴급도": request.questions.is_urgent },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("parseOpenRouterErrorBody with relayed upstream errors", () => {
  it("extracts TypeSafe's error type relayed by OpenRouter", () => {
    const body = { error: { message: 'HTTP 400: {"detail":{"error_type":"max_tokens_exceeded"}}', code: 400 } };
    expect(parseOpenRouterErrorBody(JSON.stringify(body)).message).toBe("max_tokens_exceeded");
  });

  it("extracts Cloudflare's error messages relayed by OpenRouter", () => {
    const body = {
      error: {
        message:
          'HTTP 413: {"errors":[{"message":"AiError: Ai: The estimated number of input and maximum output tokens (208406) exceeded this model context window limit (65536).","code":5021}],"success":false,"result":{},"messages":[]}',
        code: 413,
      },
    };
    expect(parseOpenRouterErrorBody(JSON.stringify(body)).message).toBe(
      "AiError: Ai: The estimated number of input and maximum output tokens (208406) exceeded this model context window limit (65536).",
    );
  });
});

describe("OpenRouterProvider refusals", () => {
  it("maps a model refusal (HTTP 502) to refused, naming the question", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        { error: { message: 'OpenAI refused to answer question "action"', code: 502 }, user_id: "user_x" },
        { status: 502 },
      ),
    );

    const error = await captureError(
      providerWith(fetchMock).evaluate({ ...request, model: "openai/gpt-6-luna-decisions" }),
    );

    expect(error.kind).toBe("refused");
    expect(error.status).toBe(502);
    expect(error.message).toBe('OpenRouter API returned HTTP 502: OpenAI refused to answer question "action"');
  });

  it("keeps other 502 errors as retryable provider errors", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ error: { message: "Provider returned error", code: 502 } }, { status: 502 }),
    );

    const error = await captureError(providerWith(fetchMock).evaluate(request));

    expect(error.kind).toBe("provider_error");
  });
});
