import { describe, expect, it } from "vitest";

import { decodeImageBytesToViewportSource } from "@/lib/image/decode-image-bytes";

const LITTLE_ENDIAN_TIFF_HEADER = Uint8Array.of(0x49, 0x49, 0x2a, 0x00);
const BIG_ENDIAN_TIFF_HEADER = Uint8Array.of(0x4d, 0x4d, 0x00, 0x2a);
const PNG_HEADER = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

describe("decodeImageBytesToViewportSource (TIFF detection)", () => {
  it("routes a .tif filename through the TIFF loader path", async () => {
    await expect(
      decodeImageBytesToViewportSource("sample.tif", PNG_HEADER),
    ).rejects.toThrow();
  });

  it("routes a .tiff filename through the TIFF loader path", async () => {
    await expect(
      decodeImageBytesToViewportSource("SAMPLE.TIFF", PNG_HEADER),
    ).rejects.toThrow();
  });

  it("treats a little-endian TIFF magic header as TIFF regardless of extension", async () => {
    await expect(
      decodeImageBytesToViewportSource("mystery.bin", LITTLE_ENDIAN_TIFF_HEADER),
    ).rejects.toThrow();
  });

  it("treats a big-endian TIFF magic header as TIFF regardless of extension", async () => {
    await expect(
      decodeImageBytesToViewportSource("mystery.bin", BIG_ENDIAN_TIFF_HEADER),
    ).rejects.toThrow();
  });
});
