import { realpath, stat, readFile } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import { JevError } from "../core/errors.js";
import { MAX_IMAGE_BYTES } from "./image-data.js";

/** Reads the bytes of a local image file named by an `images[].path` entry. */
export type ImageFileLoader = (path: string) => Promise<Uint8Array>;

function invalid(message: string): JevError {
  return new JevError("invalid_input", message);
}

function isInside(directory: string, file: string): boolean {
  const rel = relative(directory, file);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Creates a loader that only reads regular files inside `allowedDirectories`.
 * Paths are resolved with realpath first, so `..` segments and symbolic links
 * cannot escape the allowed directories.
 */
export async function createDirectoryImageLoader(
  allowedDirectories: readonly string[],
): Promise<ImageFileLoader> {
  const roots: string[] = [];
  for (const directory of allowedDirectories) {
    try {
      const resolved = await realpath(directory);
      if (!(await stat(resolved)).isDirectory()) throw new Error("not a directory");
      roots.push(resolved);
    } catch {
      throw new JevError(
        "configuration",
        `Invalid configuration: JEV_IMAGE_DIRS entry is not an existing directory: ${directory}`,
      );
    }
  }

  return async (path: string) => {
    if (!isAbsolute(path)) throw invalid(`images: path must be absolute: ${path}`);

    let resolved: string;
    try {
      resolved = await realpath(path);
    } catch {
      throw invalid(`images: file not found: ${path}`);
    }
    if (!roots.some((root) => isInside(root, resolved))) {
      throw invalid(`images: path is outside the directories allowed by JEV_IMAGE_DIRS: ${path}`);
    }

    const info = await stat(resolved);
    if (!info.isFile()) throw invalid(`images: not a regular file: ${path}`);
    if (info.size > MAX_IMAGE_BYTES) {
      throw invalid(`images: file is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MiB: ${path}`);
    }
    return readFile(resolved);
  };
}
