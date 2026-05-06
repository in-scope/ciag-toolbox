import { describe, expect, it } from "vitest";

import { computeSha256HexFromBytes } from "./content-hash";

describe("computeSha256HexFromBytes", () => {
  it("hashes an empty buffer to the well-known empty SHA-256 digest", () => {
    const digest = computeSha256HexFromBytes(new Uint8Array(0));
    expect(digest).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("hashes the bytes of \"abc\" to the well-known SHA-256 digest", () => {
    const digest = computeSha256HexFromBytes(new TextEncoder().encode("abc"));
    expect(digest).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("returns lowercase hex output of 64 characters", () => {
    const digest = computeSha256HexFromBytes(new Uint8Array([1, 2, 3]));
    expect(digest).toHaveLength(64);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
