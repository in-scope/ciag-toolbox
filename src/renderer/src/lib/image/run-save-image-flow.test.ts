import { DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE } from "@/lib/image/as-viewed-display-mapping";
import { describe, expect, it } from "vitest";

import {
  encodeRasterImageAsEnviFiles,
  encodeRasterImageAsFloat32EnviFiles,
} from "@/lib/image/encode-envi";
import { encodeRasterBandAsSingleChannelTiffBytes } from "@/lib/image/encode-tiff";
import type { RasterImage } from "@/lib/image/raster-image";
import {
  buildSaveImageFailureToastText,
  runSaveImageFlowThroughMainProcess,
  type SaveImageFlowApi,
} from "@/lib/image/run-save-image-flow";
import { TIFF_EXPORT_TOO_LARGE_MESSAGE } from "@/lib/image/tiff-export-size";
import type { ViewportImageSource } from "@/lib/webgl/texture";

// CT-237: the flow drives the chunked save-image protocol. A tiny chunk size
// forces multi-chunk uploads (with a short final chunk), and the recorded
// chunks must concatenate byte-identically to the sync encoders.
const TINY_CHUNK_BYTES = 7;

interface RecordedChunksByPart extends Record<string, Uint8Array[] | undefined> {
  primary: Uint8Array[];
  sidecar: Uint8Array[];
}

interface RecordingApi extends SaveImageFlowApi {
  readonly beginRequests: ToolboxSaveImageBeginRequest[];
  readonly chunksByPart: RecordedChunksByPart;
  readonly callOrder: string[];
}

function buildRecordingApi(
  beginResult: ToolboxSaveImageBeginResult = { status: "ready", token: "token-1" },
  chunkFailure?: Error,
): RecordingApi {
  const api: RecordingApi = {
    beginRequests: [],
    chunksByPart: { primary: [], sidecar: [] },
    callOrder: [],
    beginSaveImage: async (request) => {
      api.callOrder.push("begin");
      api.beginRequests.push(request);
      return beginResult;
    },
    sendSaveImageChunk: async (request) => {
      if (chunkFailure) throw chunkFailure;
      api.callOrder.push(`chunk:${request.part}`);
      (api.chunksByPart[request.part] ??= []).push(request.bytes);
      return undefined;
    },
    finishSaveImage: async () => {
      api.callOrder.push("finish");
      return { filePath: "C:\\exports\\saved.out" };
    },
    releaseSaveImage: async () => {
      api.callOrder.push("release");
      return undefined;
    },
  };
  return api;
}

function concatChunks(chunks: ReadonlyArray<Uint8Array>): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

function buildRasterFixture(): RasterImage {
  return {
    width: 3,
    height: 2,
    bandCount: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    sourceInterleave: "bsq",
    bandPixels: [
      new Uint16Array([10, 20, 30, 40, 50, 60]),
      new Uint16Array([110, 120, 130, 140, 150, 160]),
    ],
  };
}

function buildRasterSource(raster: RasterImage = buildRasterFixture()): ViewportImageSource {
  return { kind: "raster", raster };
}

describe("runSaveImageFlowThroughMainProcess", () => {
  it("streams an ENVI export as header + binary chunks byte-identical to the sync encoder", async () => {
    const raster = buildRasterFixture();
    const api = buildRecordingApi();
    const result = await runSaveImageFlowThroughMainProcess(
      { source: buildRasterSource(raster), selectedBandIndex: 0, originalFileName: "cube.tif", formatId: "envi", displayMapping: DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE },
      api,
      TINY_CHUNK_BYTES,
    );
    const sync = encodeRasterImageAsEnviFiles(raster);
    expect(result).toEqual({ canceled: false, filePath: "C:\\exports\\saved.out" });
    expect(concatChunks(api.chunksByPart.primary)).toEqual(sync.headerBytes);
    expect(concatChunks(api.chunksByPart.sidecar)).toEqual(sync.binaryBytes);
    expect(api.chunksByPart.sidecar.length).toBeGreaterThan(1);
  });

  it("describes the exact part byte lengths in the begin request, before any chunk moves", async () => {
    const raster = buildRasterFixture();
    const api = buildRecordingApi();
    await runSaveImageFlowThroughMainProcess(
      { source: buildRasterSource(raster), selectedBandIndex: 0, originalFileName: "cube.tif", formatId: "envi", displayMapping: DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE },
      api,
      TINY_CHUNK_BYTES,
    );
    const sync = encodeRasterImageAsEnviFiles(raster);
    expect(api.beginRequests[0]).toEqual({
      suggestedFileName: "cube.hdr",
      fileFilter: { name: "ENVI Header", extensions: ["hdr"] },
      primaryByteLength: sync.headerBytes.byteLength,
      sidecar: { extension: "bin", byteLength: sync.binaryBytes.byteLength },
    });
    expect(api.callOrder[0]).toBe("begin");
    expect(api.callOrder.at(-1)).toBe("finish");
  });

  it("streams a float32 ENVI export byte-identical to the sync float encoder", async () => {
    const raster = buildRasterFixture();
    const api = buildRecordingApi();
    await runSaveImageFlowThroughMainProcess(
      { source: buildRasterSource(raster), selectedBandIndex: 0, originalFileName: "cube.tif", formatId: "envi-float", displayMapping: DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE },
      api,
      TINY_CHUNK_BYTES,
    );
    const sync = encodeRasterImageAsFloat32EnviFiles(raster);
    expect(concatChunks(api.chunksByPart.primary)).toEqual(sync.headerBytes);
    expect(concatChunks(api.chunksByPart.sidecar)).toEqual(sync.binaryBytes);
  });

  it("streams a single-band TIFF export byte-identical to the sync encoder, with no sidecar", async () => {
    const raster = buildRasterFixture();
    const api = buildRecordingApi();
    await runSaveImageFlowThroughMainProcess(
      { source: buildRasterSource(raster), selectedBandIndex: 1, originalFileName: "cube.tif", formatId: "tiff-16-bit", displayMapping: DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE },
      api,
      TINY_CHUNK_BYTES,
    );
    expect(concatChunks(api.chunksByPart.primary)).toEqual(
      encodeRasterBandAsSingleChannelTiffBytes(raster, 1, 16),
    );
    expect(api.chunksByPart.sidecar).toEqual([]);
    expect(api.beginRequests[0]).not.toHaveProperty("sidecar");
  });

  // CT-271: 16-bit PNG uploads RAW big-endian samples; MAIN encodes on write.
  it("streams a 16-bit PNG export as raw big-endian samples with the encoding descriptor", async () => {
    const api = buildRecordingApi();
    await runSaveImageFlowThroughMainProcess(
      { source: buildRasterSource(), selectedBandIndex: 1, originalFileName: "cube.tif", formatId: "png-16-bit", displayMapping: DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE },
      api,
      TINY_CHUNK_BYTES,
    );
    expect(api.beginRequests[0]).toEqual({
      suggestedFileName: "cube.png",
      fileFilter: { name: "PNG Image", extensions: ["png"] },
      primaryByteLength: 12,
      primaryEncoding: { kind: "png-16-bit-grayscale", width: 3, height: 2 },
    });
    expect(concatChunks(api.chunksByPart.primary)).toEqual(
      Uint8Array.from([0, 110, 0, 120, 0, 130, 0, 140, 0, 150, 0, 160]),
    );
    expect(api.chunksByPart.primary.length).toBeGreaterThan(1);
    expect(api.chunksByPart.sidecar).toEqual([]);
  });

  // CT-273: a PNG stack begins a folder session, then streams one part per
  // band file (raw big-endian samples for the 16-bit variant; MAIN encodes).
  it("streams a 16-bit PNG stack as one raw-sample file per band into a folder", async () => {
    const api = buildRecordingApi();
    const result = await runSaveImageFlowThroughMainProcess(
      { source: buildRasterSource(), selectedBandIndex: 0, originalFileName: "cube.tif", formatId: "png-stack-16-bit", displayMapping: DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE },
      api,
      TINY_CHUNK_BYTES,
    );
    const encoding = { kind: "png-16-bit-grayscale", width: 3, height: 2 };
    expect(api.beginRequests[0]).toEqual({
      destination: "folder",
      files: [
        { fileName: "cube_band_001.png", byteLength: 12, encoding },
        { fileName: "cube_band_002.png", byteLength: 12, encoding },
      ],
    });
    expect(concatChunks(api.chunksByPart["file-0"]!)).toEqual(
      Uint8Array.from([0, 10, 0, 20, 0, 30, 0, 40, 0, 50, 0, 60]),
    );
    expect(concatChunks(api.chunksByPart["file-1"]!)).toEqual(
      Uint8Array.from([0, 110, 0, 120, 0, 130, 0, 140, 0, 150, 0, 160]),
    );
    expect(result).toEqual({ canceled: false, filePath: "C:\\exports\\saved.out" });
  });

  it("uploads no stack file when the folder pick is canceled", async () => {
    const api = buildRecordingApi({ status: "canceled" });
    const result = await runSaveImageFlowThroughMainProcess(
      { source: buildRasterSource(), selectedBandIndex: 0, originalFileName: "cube.tif", formatId: "png-stack-16-bit", displayMapping: DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE },
      api,
      TINY_CHUNK_BYTES,
    );
    expect(result).toEqual({ canceled: true });
    expect(api.callOrder).toEqual(["begin"]);
  });

  it("releases the folder session when a stack chunk upload fails, then rethrows", async () => {
    const api = buildRecordingApi(undefined, new Error("boom"));
    await expect(
      runSaveImageFlowThroughMainProcess(
        { source: buildRasterSource(), selectedBandIndex: 0, originalFileName: "cube.tif", formatId: "png-stack-16-bit", displayMapping: DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE },
        api,
        TINY_CHUNK_BYTES,
      ),
    ).rejects.toThrow("boom");
    expect(api.callOrder).toContain("release");
    expect(api.callOrder).not.toContain("finish");
  });

  it("reports monotonic per-band progress for a PNG stack, ending at exactly 1", async () => {
    const fractions: number[] = [];
    const api = buildRecordingApi();
    await runSaveImageFlowThroughMainProcess(
      {
        source: buildRasterSource(),
        selectedBandIndex: 0,
        originalFileName: "cube.tif",
        formatId: "png-stack-16-bit",
        displayMapping: DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE,
        onProgress: (fraction) => fractions.push(fraction),
      },
      api,
      TINY_CHUNK_BYTES,
    );
    expect(fractions.length).toBeGreaterThan(2);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    expect(fractions.at(-1)).toBe(1);
  });

  it("uploads nothing when the save dialog is canceled", async () => {
    const api = buildRecordingApi({ status: "canceled" });
    const result = await runSaveImageFlowThroughMainProcess(
      { source: buildRasterSource(), selectedBandIndex: 0, originalFileName: "cube.tif", formatId: "envi", displayMapping: DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE },
      api,
      TINY_CHUNK_BYTES,
    );
    expect(result).toEqual({ canceled: true });
    expect(api.callOrder).toEqual(["begin"]);
  });

  it("refuses an oversized TIFF export before the dialog shows or any encoding starts", async () => {
    const oversized: RasterImage = {
      width: 10_000,
      height: 5_000,
      bandCount: 100,
      bitsPerSample: 16,
      sampleFormat: "uint",
      bandPixels: [new Uint16Array(1)],
    };
    const api = buildRecordingApi();
    await expect(
      runSaveImageFlowThroughMainProcess(
        { source: buildRasterSource(oversized), selectedBandIndex: 0, originalFileName: "cube.tif", formatId: "tiff-16-bit", displayMapping: DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE },
        api,
        TINY_CHUNK_BYTES,
      ),
    ).rejects.toThrow(TIFF_EXPORT_TOO_LARGE_MESSAGE);
    expect(api.callOrder).toEqual([]);
  });

  it("releases the session when a chunk upload fails, then rethrows", async () => {
    const api = buildRecordingApi(undefined, new Error("boom"));
    await expect(
      runSaveImageFlowThroughMainProcess(
        { source: buildRasterSource(), selectedBandIndex: 0, originalFileName: "cube.tif", formatId: "envi", displayMapping: DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE },
        api,
        TINY_CHUNK_BYTES,
      ),
    ).rejects.toThrow("boom");
    expect(api.callOrder).toContain("release");
    expect(api.callOrder).not.toContain("finish");
  });

  it("reports monotonic progress ending at exactly 1", async () => {
    const fractions: number[] = [];
    const api = buildRecordingApi();
    await runSaveImageFlowThroughMainProcess(
      {
        source: buildRasterSource(),
        selectedBandIndex: 0,
        originalFileName: "cube.tif",
        formatId: "envi",
        displayMapping: DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE,
        onProgress: (fraction) => fractions.push(fraction),
      },
      api,
      TINY_CHUNK_BYTES,
    );
    expect(fractions.length).toBeGreaterThan(1);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    expect(fractions.at(-1)).toBe(1);
  });
});

describe("buildSaveImageFailureToastText", () => {
  it("shows the TIFF refusal copy alone, without the could-not-save prefix", () => {
    expect(buildSaveImageFailureToastText("cube.tif", TIFF_EXPORT_TOO_LARGE_MESSAGE)).toBe(
      TIFF_EXPORT_TOO_LARGE_MESSAGE,
    );
  });

  it("prefixes every other failure with the file name", () => {
    expect(buildSaveImageFailureToastText("cube.tif", "disk exploded")).toBe(
      "Could not save cube.tif: disk exploded",
    );
  });
});
