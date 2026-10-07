import { describe, expect, it, vi } from "vitest";
import { JevError } from "../../src/core/errors.js";
import { parseLocalErrorBody } from "../../src/providers/local/error-body.js";
import { LocalProvider } from "../../src/providers/local/local-provider.js";
import { solidPng } from "../support/images.js";

const BASE_URL = "http://127.0.0.1:8097";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
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

// Shape of llama-server b11462 serving Clef Flash with --alias clef-flash and --mmproj.
const clefModel = {
  id: "clef-flash",
  aliases: ["clef-flash"],
  object: "model",
  owned_by: "llamacpp",
  created: 1791370000,
  architecture: { input_modalities: ["text", "image", "video"], output_modalities: ["decisions"] },
};
const textOnlyModel = {
  id: "D:/models/Some-Decider-Q4_K_M.gguf",
  owned_by: "llamacpp",
  architecture: { input_modalities: ["text"], output_modalities: ["decisions"] },
};
const chatModel = {
  id: "chat-model",
  owned_by: "llamacpp",
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
};

const wireResponse = {
  model: "clef-flash",
  answers: { q: { type: "noul", noul: 0.84 } },
  usage: { input_tokens: 338, output_tokens: 0 },
};

const request = {
  state: "Help! My payouts have been failing for 3 days.",
  model: "clef-flash",
  questions: { q: { type: "noul" as const, instructions: "Does this convey urgency?" } },
};

const png = solidPng([220, 20, 20]);
const pngImage = { mediaType: "image/png" as const, base64: png.toString("base64"), byteLength: png.byteLength };
const webpImage = { mediaType: "image/webp" as const, base64: "UklGRg==", byteLength: 4 };

function server(models: unknown[]) {
  return vi.fn<typeof fetch>(async (url) =>
    String(url).endsWith("/v1/models") ? jsonResponse({ object: "list", data: models }) : jsonResponse(wireResponse),
  );
}

function postedBody(fetchMock: ReturnType<typeof server>): Record<string, unknown> {
  const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
  return JSON.parse(post![1]!.body as string) as Record<string, unknown>;
}

describe("LocalProvider.evaluate", () => {
  it("POSTs the System One request to the local server without auth by default", async () => {
    const fetchMock = server([clefModel]);

    const result = await new LocalProvider({ baseUrl: BASE_URL, fetch: fetchMock }).evaluate(request);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:8097/v1/systemone");
    expect(init?.headers).not.toHaveProperty("Authorization");
    expect(postedBody(fetchMock)).toEqual(request);
    expect(result).toEqual({
      model: "clef-flash",
      answers: { q: { type: "noul", noul: 0.84 } },
      usage: { inputTokens: 338, outputTokens: 0 },
    });
  });

  it("sends a Bearer token when a key is configured", async () => {
    const fetchMock = server([clefModel]);

    await new LocalProvider({ baseUrl: BASE_URL, apiKey: "local-secret", fetch: fetchMock }).evaluate(request);

    expect(fetchMock.mock.calls[0]![1]?.headers).toMatchObject({ Authorization: "Bearer local-secret" });
  });

  it("sends images in the documented images field as data URLs", async () => {
    const fetchMock = server([clefModel]);

    await new LocalProvider({ baseUrl: BASE_URL, fetch: fetchMock }).evaluate({ ...request, images: [pngImage] });

    expect(postedBody(fetchMock)).toEqual({
      ...request,
      images: [`data:image/png;base64,${png.toString("base64")}`],
    });
  });

  it("resolves the model by alias and falls back to the only decision model", async () => {
    const fetchMock = server([clefModel, chatModel]);
    const provider = new LocalProvider({ baseUrl: BASE_URL, fetch: fetchMock });

    await provider.evaluate({ ...request, images: [pngImage] });
    await provider.evaluate({ ...request, model: "jev-latest", images: [pngImage] });

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
  });

  it("rejects images for a model without an image input modality", async () => {
    const fetchMock = server([textOnlyModel]);

    const error = await captureError(
      new LocalProvider({ baseUrl: BASE_URL, fetch: fetchMock }).evaluate({ ...request, images: [pngImage] }),
    );

    expect(error.kind).toBe("invalid_input");
    expect(error.message).toContain("does not accept images");
    expect(error.message).toContain("--mmproj");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("rejects WebP for llama-server, which cannot load it", async () => {
    const fetchMock = server([clefModel]);

    const error = await captureError(
      new LocalProvider({ baseUrl: BASE_URL, fetch: fetchMock }).evaluate({ ...request, images: [webpImage] }),
    );

    expect(error.message).toBe("llama-server cannot load WebP images; convert them to PNG or JPEG");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("allows WebP for other local servers", async () => {
    const fetchMock = server([{ ...clefModel, owned_by: "von" }]);

    await new LocalProvider({ baseUrl: BASE_URL, fetch: fetchMock }).evaluate({ ...request, images: [webpImage] });

    expect(postedBody(fetchMock).images).toEqual(["data:image/webp;base64,UklGRg=="]);
  });

  it("rejects an unknown model when several decision models are served", async () => {
    const fetchMock = server([clefModel, textOnlyModel]);

    const error = await captureError(
      new LocalProvider({ baseUrl: BASE_URL, fetch: fetchMock }).evaluate({
        ...request,
        model: "jev-latest",
        images: [pngImage],
      }),
    );

    expect(error.message).toContain("Model jev-latest is not served by the local server");
  });

  it("names the local server in network errors", async () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8097"), { code: "ECONNREFUSED" });
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed", { cause }));

    const error = await captureError(new LocalProvider({ baseUrl: BASE_URL, fetch: fetchMock }).evaluate(request));

    expect(error.kind).toBe("network");
    expect(error.message).toBe(
      "Could not reach the Local server API (ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:8097)",
    );
  });

  it.each([
    [401, { error: { code: 401, message: "Invalid API Key", type: "authentication_error" } }, "authentication"],
    [503, { error: { code: 503, message: "Loading model", type: "unavailable_error" } }, "provider_error"],
    [400, { error: { code: 400, message: "bad request", type: "invalid_request_error" } }, "invalid_request"],
  ] as const)("maps documented error %i to %s", async (status, body, kind) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body, { status }));

    const error = await captureError(new LocalProvider({ baseUrl: BASE_URL, fetch: fetchMock }).evaluate(request));

    expect(error.kind).toBe(kind);
    expect(error.message).toBe(`Local server API returned HTTP ${status}: ${body.error.message}`);
  });
});

describe("LocalProvider.models", () => {
  it("lists decision models only, without inventing descriptions or dates", async () => {
    const fetchMock = server([clefModel, textOnlyModel, chatModel]);

    const result = await new LocalProvider({ baseUrl: BASE_URL, fetch: fetchMock }).models();

    expect(fetchMock.mock.calls[0]![0]).toBe("http://127.0.0.1:8097/v1/models");
    expect(result).toEqual({ models: [{ name: "clef-flash" }, { name: "D:/models/Some-Decider-Q4_K_M.gguf" }] });
  });

  it("rejects an unexpected model list", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ models: "nope" }));

    const error = await captureError(new LocalProvider({ baseUrl: BASE_URL, fetch: fetchMock }).models());

    expect(error.kind).toBe("invalid_response");
  });
});

describe("parseLocalErrorBody", () => {
  it("keeps non-JSON bodies as text", () => {
    expect(parseLocalErrorBody("upstream timeout").details).toBe("upstream timeout");
  });
});
