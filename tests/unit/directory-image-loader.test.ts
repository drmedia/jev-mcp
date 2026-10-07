import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JevError } from "../../src/core/errors.js";
import {
  createDirectoryImageLoader,
  type ImageFileLoader,
} from "../../src/images/directory-image-loader.js";
import { MAX_IMAGE_BYTES } from "../../src/images/image-data.js";
import { solidPng } from "../support/images.js";

let root: string;
let allowed: string;
let outside: string;
let load: ImageFileLoader;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "jev-images-"));
  allowed = join(root, "allowed");
  outside = join(root, "outside");
  await mkdir(join(allowed, "nested"), { recursive: true });
  await mkdir(outside);
  await writeFile(join(allowed, "red.png"), solidPng([220, 20, 20]));
  await writeFile(join(allowed, "nested", "blue.png"), solidPng([20, 40, 220]));
  await writeFile(join(allowed, "huge.png"), Buffer.alloc(MAX_IMAGE_BYTES + 1));
  await writeFile(join(outside, "secret.png"), solidPng([1, 2, 3]));
  load = await createDirectoryImageLoader([allowed]);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function inputError(promise: Promise<unknown>): Promise<string> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(JevError);
  expect((error as JevError).kind).toBe("invalid_input");
  return (error as JevError).message;
}

describe("createDirectoryImageLoader", () => {
  it("reads files inside an allowed directory, including subdirectories", async () => {
    expect(await load(join(allowed, "red.png"))).toEqual(solidPng([220, 20, 20]));
    expect(await load(join(allowed, "nested", "blue.png"))).toEqual(solidPng([20, 40, 220]));
  });

  it("refuses files outside the allowed directories", async () => {
    expect(await inputError(load(join(outside, "secret.png")))).toMatch(/outside the directories allowed by JEV_IMAGE_DIRS/);
  });

  it("refuses .. segments that leave the allowed directory", async () => {
    expect(await inputError(load(join(allowed, "..", "outside", "secret.png")))).toMatch(/outside the directories allowed/);
  });

  it("refuses the allowed directory itself and other non-files", async () => {
    expect(await inputError(load(allowed))).toMatch(/outside the directories allowed/);
    expect(await inputError(load(join(allowed, "nested")))).toMatch(/not a regular file/);
  });

  it("refuses relative paths and missing files", async () => {
    expect(await inputError(load("red.png"))).toMatch(/path must be absolute/);
    expect(await inputError(load(join(allowed, "missing.png")))).toMatch(/file not found/);
  });

  it("refuses files over 4 MiB without reading them", async () => {
    expect(await inputError(load(join(allowed, "huge.png")))).toMatch(/larger than 4 MiB/);
  });

  it("refuses a symbolic link that points outside the allowed directories", async (context) => {
    const link = join(allowed, "link.png");
    try {
      await symlink(join(outside, "secret.png"), link);
    } catch {
      context.skip(); // Creating symlinks needs extra privileges on some Windows setups.
    }
    expect(await inputError(load(link))).toMatch(/outside the directories allowed/);
  });

  it("fails configuration when an allowed directory does not exist", async () => {
    const error = await createDirectoryImageLoader([join(root, "nope")]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JevError);
    expect((error as JevError).kind).toBe("configuration");
  });
});
