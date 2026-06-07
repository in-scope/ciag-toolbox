import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_OPENABLE_FILE_BYTES,
  describeFileSizeExceedsOpenableLimit,
  isFileSizeWithinOpenableLimit,
  readFileWithinOpenableSizeLimitOrThrow,
  resolveMaxOpenableFileBytes,
} from "./openable-file-size-limit";

const ENV_VAR = "CT_MAX_OPENABLE_FILE_BYTES";

describe("DEFAULT_MAX_OPENABLE_FILE_BYTES", () => {
  it("is 16 GiB", () => {
    expect(DEFAULT_MAX_OPENABLE_FILE_BYTES).toBe(16 * 1024 * 1024 * 1024);
  });
});

describe("resolveMaxOpenableFileBytes", () => {
  const originalValue = process.env[ENV_VAR];

  afterEach(() => {
    if (originalValue === undefined) delete process.env[ENV_VAR];
    else process.env[ENV_VAR] = originalValue;
  });

  it("returns the default when the override is unset", () => {
    delete process.env[ENV_VAR];
    expect(resolveMaxOpenableFileBytes()).toBe(DEFAULT_MAX_OPENABLE_FILE_BYTES);
  });

  it("returns a valid positive-integer override", () => {
    process.env[ENV_VAR] = "1024";
    expect(resolveMaxOpenableFileBytes()).toBe(1024);
  });

  it("ignores a non-numeric or non-positive override and falls back to the default", () => {
    process.env[ENV_VAR] = "not-a-number";
    expect(resolveMaxOpenableFileBytes()).toBe(DEFAULT_MAX_OPENABLE_FILE_BYTES);
    process.env[ENV_VAR] = "0";
    expect(resolveMaxOpenableFileBytes()).toBe(DEFAULT_MAX_OPENABLE_FILE_BYTES);
    process.env[ENV_VAR] = "-5";
    expect(resolveMaxOpenableFileBytes()).toBe(DEFAULT_MAX_OPENABLE_FILE_BYTES);
  });
});

describe("isFileSizeWithinOpenableLimit", () => {
  it("accepts sizes at or below the limit and rejects above", () => {
    expect(isFileSizeWithinOpenableLimit(99, 100)).toBe(true);
    expect(isFileSizeWithinOpenableLimit(100, 100)).toBe(true);
    expect(isFileSizeWithinOpenableLimit(101, 100)).toBe(false);
  });
});

describe("describeFileSizeExceedsOpenableLimit", () => {
  it("names the file, its size, and the limit in gigabytes", () => {
    const message = describeFileSizeExceedsOpenableLimit(
      "cube.bin",
      18 * 1024 * 1024 * 1024,
      16 * 1024 * 1024 * 1024,
    );
    expect(message).toContain("cube.bin");
    expect(message).toContain("18.0 GB");
    expect(message).toContain("16.0 GB");
  });
});

describe("readFileWithinOpenableSizeLimitOrThrow", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "openable-size-"));
  });

  afterEach(async () => {
    delete process.env[ENV_VAR];
    await rm(tempDir, { recursive: true, force: true });
  });

  it("reads the full file bytes when it is within the limit", async () => {
    const filePath = join(tempDir, "small.bin");
    await writeFile(filePath, Uint8Array.of(1, 2, 3, 4));
    const bytes = await readFileWithinOpenableSizeLimitOrThrow(filePath);
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
  });

  it("throws an error naming the limit when the file exceeds it", async () => {
    process.env[ENV_VAR] = "2";
    const filePath = join(tempDir, "too-big.bin");
    await writeFile(filePath, Uint8Array.of(1, 2, 3, 4));
    await expect(readFileWithinOpenableSizeLimitOrThrow(filePath)).rejects.toThrow(
      /maximum openable file size/,
    );
  });
});
