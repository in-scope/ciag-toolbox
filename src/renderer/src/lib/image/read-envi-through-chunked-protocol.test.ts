import { describe, expect, it } from "vitest";

import { loadEnviAsRaster } from "@/lib/image/load-envi";
import {
  readAndDecodeEnviHeaderFileStreamingChunks,
  type ChunkedOpenedImageReadApi,
} from "@/lib/image/read-envi-through-chunked-protocol";

const METADATA: ToolboxOpenImagesDialogFileMetadataEntry = {
  fileName: "stack.hdr",
  filePath: "C:\\captures\\stack.hdr",
  fileSizeBytes: 120,
  mtimeMs: 42.5,
};

const HEADER_TEXT = [
  "ENVI",
  "samples = 2",
  "lines = 2",
  "bands = 2",
  "header offset = 0",
  "data type = 12",
  "interleave = bsq",
  "byte order = 0",
  "",
].join("\n");

function buildUint16LittleEndianBinary(values: ReadonlyArray<number>): Uint8Array {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint16(index * 2, value, true));
  return bytes;
}

const BINARY_BYTES = buildUint16LittleEndianBinary([10, 20, 30, 40, 110, 120, 130, 140]);
const HEADER_BYTES = new TextEncoder().encode(HEADER_TEXT);

interface FakeApiOptions {
  readonly headerBytes?: Uint8Array;
  readonly binaryBytes?: Uint8Array;
  readonly chunkBytes?: number;
  readonly sidecarMissing?: boolean;
}

interface FakeApi {
  readonly api: ChunkedOpenedImageReadApi;
  readonly calls: string[];
}

function createFakeChunkedReadApi(options: FakeApiOptions = {}): FakeApi {
  const headerBytes = options.headerBytes ?? HEADER_BYTES;
  const binaryBytes = options.binaryBytes ?? BINARY_BYTES;
  const chunkBytes = options.chunkBytes ?? 3;
  const calls: string[] = [];
  const offsets = { file: 0, sidecar: 0 };
  const api: ChunkedOpenedImageReadApi = {
    begin: async () => {
      calls.push("begin");
      return {
        token: "token-1",
        fileSizeBytes: headerBytes.byteLength,
        sidecar: options.sidecarMissing
          ? null
          : { fileName: "stack.raw", sizeBytes: binaryBytes.byteLength },
      };
    },
    readChunk: async ({ target }) => {
      calls.push(`chunk:${target}`);
      const source = target === "file" ? headerBytes : binaryBytes;
      const bytes = source.subarray(offsets[target], offsets[target] + chunkBytes);
      offsets[target] += bytes.byteLength;
      return { done: offsets[target] >= source.byteLength, bytes };
    },
    finish: async () => {
      calls.push("finish");
      return { contentHash: "hash-of-header" };
    },
    abort: async () => {
      calls.push("abort");
    },
  };
  return { api, calls };
}

describe("readAndDecodeEnviHeaderFileStreamingChunks", () => {
  it("decodes the sidecar chunk-by-chunk into the same raster as the whole-buffer load", async () => {
    const fake = createFakeChunkedReadApi({ chunkBytes: 3 });
    const entry = await readAndDecodeEnviHeaderFileStreamingChunks(fake.api, METADATA);
    const expected = loadEnviAsRaster(HEADER_BYTES, BINARY_BYTES);
    expect(entry.decodeError).toBeNull();
    const source = entry.source;
    expect(source?.kind).toBe("raster");
    const raster = source && source.kind === "raster" ? source.raster : null;
    expect(Array.from(raster!.bandPixels[0]!)).toEqual(Array.from(expected.bandPixels[0]!));
    expect(Array.from(raster!.bandPixels[1]!)).toEqual(Array.from(expected.bandPixels[1]!));
    expect(raster!.bandCount).toBe(2);
  });

  it("carries the protocol content hash and the sidecar identity without retaining any bytes", async () => {
    const fake = createFakeChunkedReadApi();
    const entry = await readAndDecodeEnviHeaderFileStreamingChunks(fake.api, METADATA);
    expect(entry.contentHash).toBe("hash-of-header");
    expect("bytes" in entry).toBe(false);
    expect(entry.sidecarFileName).toBe("stack.raw");
    expect(entry.sidecarSizeBytes).toBe(BINARY_BYTES.byteLength);
    expect(entry.fileName).toBe("stack.hdr");
    expect(entry.mtimeMs).toBe(42.5);
    expect(fake.calls).toContain("finish");
    expect(fake.calls).not.toContain("abort");
  });

  it("reports determinate progress fractions that end at exactly 1", async () => {
    const fake = createFakeChunkedReadApi({ chunkBytes: 5 });
    const fractions: number[] = [];
    await readAndDecodeEnviHeaderFileStreamingChunks(fake.api, METADATA, (fraction) =>
      fractions.push(fraction),
    );
    expect(fractions[0]).toBe(0);
    expect(fractions[fractions.length - 1]).toBe(1);
    for (let index = 1; index < fractions.length; index++) {
      expect(fractions[index]!).toBeGreaterThanOrEqual(fractions[index - 1]!);
    }
  });

  it("turns a corrupt header into a decodeError entry and aborts the session", async () => {
    const fake = createFakeChunkedReadApi({
      headerBytes: new TextEncoder().encode("not an envi header"),
    });
    const entry = await readAndDecodeEnviHeaderFileStreamingChunks(fake.api, METADATA);
    expect(entry.decodeError).toMatch(/ENVI magic line/);
    expect(entry.source).toBeNull();
    expect(fake.calls).toContain("abort");
    expect(fake.calls).not.toContain("finish");
  });

  it("turns a missing binary sibling into a decodeError entry", async () => {
    const fake = createFakeChunkedReadApi({ sidecarMissing: true });
    const entry = await readAndDecodeEnviHeaderFileStreamingChunks(fake.api, METADATA);
    expect(entry.decodeError).toMatch(/requires a sibling binary/);
    expect(fake.calls).toContain("abort");
  });

  it("turns a truncated sidecar into a decodeError entry instead of looping", async () => {
    const fake = createFakeChunkedReadApi({
      binaryBytes: BINARY_BYTES.subarray(0, 6),
    });
    const entry = await readAndDecodeEnviHeaderFileStreamingChunks(fake.api, METADATA);
    expect(entry.decodeError).toMatch(/smaller than expected/);
    expect(fake.calls).toContain("abort");
  });

  it("propagates a begin failure so the caller's open flow surfaces it", async () => {
    const failing: ChunkedOpenedImageReadApi = {
      ...createFakeChunkedReadApi().api,
      begin: async () => {
        throw new Error("file is larger than the 16 GB the app can open");
      },
    };
    await expect(
      readAndDecodeEnviHeaderFileStreamingChunks(failing, METADATA),
    ).rejects.toThrow(/16 GB/);
  });
});
