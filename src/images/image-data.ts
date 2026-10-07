import { JevError } from "../core/errors.js";
import type { JevImage, JevImageMediaType } from "../core/provider.js";

// Limits follow Cloudflare's Clef input schema (checked 2026-10-07): at most 4
// embedded PNG, JPEG or WebP images, 4 MiB each and 8 MiB in total.
export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 8 * 1024 * 1024;

const MEDIA_TYPE_ALIASES: Record<string, JevImageMediaType> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/webp": "image/webp",
};

function invalid(message: string): JevError {
  return new JevError("invalid_input", message);
}

/** Detects the image format from its magic bytes; the declared type is never trusted. */
export function detectImageType(bytes: Uint8Array): JevImageMediaType | undefined {
  const starts = (...signature: number[]) => signature.every((byte, i) => bytes[i] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  const riff = starts(0x52, 0x49, 0x46, 0x46); // "RIFF"
  const webp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50; // "WEBP"
  if (riff && webp) return "image/webp";
  return undefined;
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/** Validates raw image bytes and returns a provider-neutral image. */
export function imageFromBytes(bytes: Uint8Array, label: string): JevImage {
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw invalid(`${label}: image is ${megabytes(bytes.byteLength)}; the limit is ${megabytes(MAX_IMAGE_BYTES)}`);
  }
  const mediaType = detectImageType(bytes);
  if (mediaType === undefined) {
    throw invalid(`${label}: not a PNG, JPEG or WebP image`);
  }
  return { mediaType, base64: Buffer.from(bytes).toString("base64"), byteLength: bytes.byteLength };
}

const DATA_URL = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Parses `data:image/<type>;base64,<data>` and validates the decoded image. */
export function imageFromDataUrl(dataUrl: string, label: string): JevImage {
  const match = DATA_URL.exec(dataUrl.trim());
  if (!match) throw invalid(`${label}: data must be a data URL such as data:image/png;base64,...`);
  const [, declared = "", parameters = "", payload = ""] = match;
  if (!parameters.split(";").includes("base64")) {
    throw invalid(`${label}: data URL must be base64-encoded (;base64,)`);
  }
  const declaredType = MEDIA_TYPE_ALIASES[declared.toLowerCase()];
  if (declaredType === undefined) {
    throw invalid(`${label}: data URL type must be image/png, image/jpeg or image/webp`);
  }

  const encoded = payload.replace(/\s+/g, "");
  if (!BASE64.test(encoded) || encoded.length % 4 === 1) {
    throw invalid(`${label}: data URL contains invalid base64`);
  }
  // Check the size before decoding so oversized input is never materialized.
  const estimatedBytes = Math.floor((encoded.length * 3) / 4);
  if (estimatedBytes > MAX_IMAGE_BYTES + 2) {
    throw invalid(`${label}: image is about ${megabytes(estimatedBytes)}; the limit is ${megabytes(MAX_IMAGE_BYTES)}`);
  }

  const image = imageFromBytes(Buffer.from(encoded, "base64"), label);
  if (image.mediaType !== declaredType) {
    throw invalid(`${label}: data URL says ${declaredType} but the bytes are ${image.mediaType}`);
  }
  return image;
}

/** Enforces the per-request limits on an already validated set of images. */
export function checkImageSet(images: readonly JevImage[]): void {
  if (images.length > MAX_IMAGES) {
    throw invalid(`images: at most ${MAX_IMAGES} images are allowed, got ${images.length}`);
  }
  const total = images.reduce((sum, image) => sum + image.byteLength, 0);
  if (total > MAX_TOTAL_IMAGE_BYTES) {
    throw invalid(`images: ${megabytes(total)} in total; the limit is ${megabytes(MAX_TOTAL_IMAGE_BYTES)}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True when `state` contains an image content part anywhere, in the format OpenRouter
 * documents (`{ "type": "image_url", "image_url": { "url": ... } }`,
 * https://openrouter.ai/docs/guides/overview/multimodal/image-understanding.md).
 * Images must use the `images` field so they are validated and only sent to models
 * that can read them; an image part in `state` would bypass both checks.
 */
export function containsImagePart(value: unknown, depth = 0): boolean {
  if (depth > 64) return false;
  if (Array.isArray(value)) return value.some((item) => containsImagePart(item, depth + 1));
  if (!isRecord(value)) return false;
  if (value.type === "image_url" && "image_url" in value) return true;
  return Object.values(value).some((item) => containsImagePart(item, depth + 1));
}
