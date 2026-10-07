import { describe, expect, it } from "vitest";
import { JevError } from "../../src/core/errors.js";
import {
  checkImageSet,
  containsImagePart,
  detectImageType,
  imageFromBytes,
  imageFromDataUrl,
  MAX_IMAGE_BYTES,
} from "../../src/images/image-data.js";
import { pngDataUrl, SIGNATURES, solidPng } from "../support/images.js";

function inputError(fn: () => unknown): JevError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(JevError);
    expect((error as JevError).kind).toBe("invalid_input");
    return error as JevError;
  }
  throw new Error("expected an invalid_input error");
}

describe("detectImageType", () => {
  it("recognizes PNG, JPEG and WebP from their bytes", () => {
    expect(detectImageType(solidPng([1, 2, 3]))).toBe("image/png");
    expect(detectImageType(SIGNATURES.jpeg)).toBe("image/jpeg");
    expect(detectImageType(SIGNATURES.webp)).toBe("image/webp");
  });

  it("rejects other formats and plain text", () => {
    expect(detectImageType(SIGNATURES.gif)).toBeUndefined();
    expect(detectImageType(Buffer.from("not an image"))).toBeUndefined();
    expect(detectImageType(Buffer.alloc(0))).toBeUndefined();
  });
});

describe("imageFromDataUrl", () => {
  it("accepts a PNG data URL and keeps the bytes as base64", () => {
    const png = solidPng([220, 20, 20]);
    expect(imageFromDataUrl(pngDataUrl([220, 20, 20]), "images[0]")).toEqual({
      mediaType: "image/png",
      base64: png.toString("base64"),
      byteLength: png.byteLength,
    });
  });

  it("accepts image/jpg as an alias for image/jpeg", () => {
    const url = `data:image/jpg;base64,${SIGNATURES.jpeg.toString("base64")}`;
    expect(imageFromDataUrl(url, "images[0]").mediaType).toBe("image/jpeg");
  });

  it.each([
    ["a remote URL", "https://example.com/photo.png", /must be a data URL/],
    ["a non-base64 data URL", "data:image/png,rawbytes", /must be base64-encoded/],
    ["an unsupported type", `data:image/gif;base64,${SIGNATURES.gif.toString("base64")}`, /image\/png, image\/jpeg or image\/webp/],
    ["invalid base64", "data:image/png;base64,@@@@", /invalid base64/],
    ["bytes that are not an image", `data:image/png;base64,${Buffer.from("hello").toString("base64")}`, /not a PNG, JPEG or WebP image/],
    [
      "a declared type that does not match the bytes",
      `data:image/jpeg;base64,${solidPng([1, 2, 3]).toString("base64")}`,
      /says image\/jpeg but the bytes are image\/png/,
    ],
  ])("rejects %s", (_label, url, message) => {
    expect(inputError(() => imageFromDataUrl(url, "images[0]")).message).toMatch(message);
  });

  it("rejects an oversized image before decoding it", () => {
    const url = `data:image/png;base64,${"A".repeat(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8)}`;
    expect(inputError(() => imageFromDataUrl(url, "images[1]")).message).toMatch(
      /^images\[1\]: image is about 4\.0 MiB; the limit is 4\.0 MiB/,
    );
  });
});

describe("imageFromBytes", () => {
  it("rejects files over 4 MiB", () => {
    const big = Buffer.concat([solidPng([1, 2, 3]), Buffer.alloc(MAX_IMAGE_BYTES)]);
    expect(inputError(() => imageFromBytes(big, "images[0]")).message).toMatch(/the limit is 4\.0 MiB/);
  });
});

describe("checkImageSet", () => {
  const image = (byteLength: number) => ({ mediaType: "image/png" as const, base64: "", byteLength });

  it("allows up to 4 images and 8 MiB in total", () => {
    expect(() => checkImageSet([image(2 * 1024 * 1024), image(2 * 1024 * 1024)])).not.toThrow();
  });

  it("rejects more than 4 images", () => {
    expect(inputError(() => checkImageSet(Array.from({ length: 5 }, () => image(10)))).message).toMatch(
      /at most 4 images are allowed, got 5/,
    );
  });

  it("rejects more than 8 MiB in total", () => {
    const set = Array.from({ length: 3 }, () => image(3 * 1024 * 1024));
    expect(inputError(() => checkImageSet(set)).message).toMatch(/9\.0 MiB in total; the limit is 8\.0 MiB/);
  });
});

describe("containsImagePart", () => {
  const part = { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } };

  it("finds image parts at any depth", () => {
    expect(containsImagePart([part, "text"])).toBe(true);
    expect(containsImagePart({ record: { attachments: [part] } })).toBe(true);
  });

  it("ignores ordinary data that merely mentions images", () => {
    expect(containsImagePart("see image_url")).toBe(false);
    expect(containsImagePart({ type: "image", name: "photo.jpg" })).toBe(false);
    expect(containsImagePart({ type: "image_url" })).toBe(false);
    expect(containsImagePart([{ kind: "photo", url: "https://example.com/a.png" }])).toBe(false);
  });
});
