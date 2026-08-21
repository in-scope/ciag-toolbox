import { describe, expect, it, vi } from "vitest";

import { INTERLACED_PNG_REFUSAL_MESSAGE } from "@shared/png-header";

import { decodeImageBytesToViewportSource } from "@/lib/image/decode-image-bytes";
import { loadPng16RasterThroughChunkedDecode } from "@/lib/image/load-png16";

vi.mock("@/lib/image/load-raw", () => ({
  loadRawAsRaster: vi.fn(async () => {
    throw new Error("raw loader stub invoked");
  }),
}));

vi.mock("@/lib/image/load-png16", () => ({
  loadPng16RasterThroughChunkedDecode: vi.fn(async () => {
    throw new Error("png16 loader stub invoked");
  }),
}));

const LITTLE_ENDIAN_TIFF_HEADER = Uint8Array.of(0x49, 0x49, 0x2a, 0x00);
const BIG_ENDIAN_TIFF_HEADER = Uint8Array.of(0x4d, 0x4d, 0x00, 0x2a);
const PNG_HEADER = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

describe("decodeImageBytesToViewportSource (TIFF detection)", () => {
  it("routes a .tif filename through the TIFF loader path", async () => {
    await expect(
      decodeImageBytesToViewportSource({ fileName: "sample.tif", bytes: PNG_HEADER }),
    ).rejects.toThrow();
  });

  it("routes a .tiff filename through the TIFF loader path", async () => {
    await expect(
      decodeImageBytesToViewportSource({ fileName: "SAMPLE.TIFF", bytes: PNG_HEADER }),
    ).rejects.toThrow();
  });

  it("treats a little-endian TIFF magic header as TIFF regardless of extension", async () => {
    await expect(
      decodeImageBytesToViewportSource({
        fileName: "mystery.bin",
        bytes: LITTLE_ENDIAN_TIFF_HEADER,
      }),
    ).rejects.toThrow();
  });

  it("treats a big-endian TIFF magic header as TIFF regardless of extension", async () => {
    await expect(
      decodeImageBytesToViewportSource({
        fileName: "mystery.bin",
        bytes: BIG_ENDIAN_TIFF_HEADER,
      }),
    ).rejects.toThrow();
  });
});

describe("decodeImageBytesToViewportSource (ENVI detection)", () => {
  it("rejects a .hdr file when no sidecar binary bytes are provided", async () => {
    const headerBytes = new TextEncoder().encode("ENVI\n");
    await expect(
      decodeImageBytesToViewportSource({ fileName: "scene.hdr", bytes: headerBytes }),
    ).rejects.toThrow(/sibling binary file/);
  });
});

interface SixteenBitPngHeaderFields {
  readonly bitDepth?: number;
  readonly colorType?: number;
  readonly interlaceMethod?: number;
}

function buildPngFilePrefix(fields: SixteenBitPngHeaderFields = {}): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, 5);
  view.setUint32(20, 4);
  bytes[24] = fields.bitDepth ?? 16;
  bytes[25] = fields.colorType ?? 0;
  bytes[28] = fields.interlaceMethod ?? 0;
  return bytes;
}

// CT-272: a 16-bit PNG must NEVER reach the browser decode path (Chromium
// silently downscales it to 8 bits); it routes to the main-process chunked
// decoder, which needs the file's on-disk path.
describe("decodeImageBytesToViewportSource (16-bit PNG routing)", () => {
  it("routes a 16-bit grayscale PNG with a path to the main-process decoder", async () => {
    await expect(
      decodeImageBytesToViewportSource({
        fileName: "depth.png",
        bytes: buildPngFilePrefix(),
        filePath: "C:/pictures/depth.png",
      }),
    ).rejects.toThrow(/png16 loader stub invoked/);
    expect(vi.mocked(loadPng16RasterThroughChunkedDecode)).toHaveBeenCalledWith(
      expect.anything(),
      "C:/pictures/depth.png",
      undefined,
    );
  });

  it("rejects a 16-bit PNG whose open path carried no file path", async () => {
    await expect(
      decodeImageBytesToViewportSource({ fileName: "depth.png", bytes: buildPngFilePrefix() }),
    ).rejects.toThrow(/needs the file's path/);
  });

  it("refuses an interlaced 16-bit PNG with the locked re-export message", async () => {
    await expect(
      decodeImageBytesToViewportSource({
        fileName: "depth.png",
        bytes: buildPngFilePrefix({ interlaceMethod: 1 }),
        filePath: "C:/pictures/depth.png",
      }),
    ).rejects.toThrow(INTERLACED_PNG_REFUSAL_MESSAGE);
  });

  it("keeps an 8-bit PNG away from the 16-bit decoder", async () => {
    vi.mocked(loadPng16RasterThroughChunkedDecode).mockClear();
    await decodeImageBytesToViewportSource({
      fileName: "photo.png",
      bytes: buildPngFilePrefix({ bitDepth: 8 }),
      filePath: "C:/pictures/photo.png",
    }).catch(() => undefined);
    expect(vi.mocked(loadPng16RasterThroughChunkedDecode)).not.toHaveBeenCalled();
  });
});

describe("decodeImageBytesToViewportSource (raw camera detection)", () => {
  const RAW_EXTENSIONS_TO_TEST = ["dng", "cr3", "arw", "nef", "raf", "orf", "pef", "rw2"];

  for (const extension of RAW_EXTENSIONS_TO_TEST) {
    it(`routes a .${extension} filename through the raw loader path`, async () => {
      await expect(
        decodeImageBytesToViewportSource({
          fileName: `capture.${extension}`,
          bytes: PNG_HEADER,
        }),
      ).rejects.toThrow(/raw loader stub invoked/);
    });
  }

  it("treats raw extensions as case-insensitive", async () => {
    await expect(
      decodeImageBytesToViewportSource({ fileName: "PHOTO.DNG", bytes: PNG_HEADER }),
    ).rejects.toThrow(/raw loader stub invoked/);
  });
});
