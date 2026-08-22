import { describe, expect, it, vi } from "vitest";

import { createMaskLayer, type MaskLayer } from "@/lib/masks/mask-layer";
import { decodeMaskPngBytes } from "@/lib/masks/mask-png-decode";
import { parseMaskSidecarDocumentOrNull } from "@/lib/masks/mask-sidecar";
import {
  buildSuggestedMaskFileName,
  exportMaskLayerThroughSaveDialog,
} from "@/lib/masks/run-mask-export-flow";

// CT-303: the export drives the chunked save-image protocol - begin (which
// resolves the save dialog before any bytes move), the PNG and sidecar parts
// in bounded chunks, then finish. A failure releases the session so no partial
// files survive.

interface RecordedChunk {
  readonly part: string;
  readonly bytes: Uint8Array;
}

function buildLayerToExport(): MaskLayer {
  const layer = createMaskLayer("mask-1", "Parchment mask", 4, 2);
  layer.values.set([0, 1, 1, 0, 2, 2, 0, 0]);
  return layer;
}

function createFakeSaveApi(overrides: Partial<Record<string, unknown>> = {}) {
  const chunks: RecordedChunk[] = [];
  const requests: unknown[] = [];
  const api = {
    beginSaveImage: vi.fn(async (request: unknown) => {
      requests.push(request);
      return { status: "ready", token: "token-1" } as const;
    }),
    sendSaveImageChunk: vi.fn(async (request: { part: string; bytes: Uint8Array }) => {
      chunks.push({ part: request.part, bytes: request.bytes });
    }),
    finishSaveImage: vi.fn(async () => ({ filePath: "C:/tmp/parchment-mask.png" })),
    releaseSaveImage: vi.fn(async () => undefined),
    ...overrides,
  };
  return { api, chunks, requests };
}

function joinChunksForPart(chunks: ReadonlyArray<RecordedChunk>, part: string): Uint8Array {
  const parts = chunks.filter((chunk) => chunk.part === part).map((chunk) => chunk.bytes);
  const joined = new Uint8Array(parts.reduce((total, bytes) => total + bytes.byteLength, 0));
  let offset = 0;
  for (const bytes of parts) {
    joined.set(bytes, offset);
    offset += bytes.byteLength;
  }
  return joined;
}

describe("exportMaskLayerThroughSaveDialog", () => {
  it("uploads the mask PNG and its sidecar, then finishes", async () => {
    const { api, chunks, requests } = createFakeSaveApi();
    const result = await exportMaskLayerThroughSaveDialog(buildLayerToExport(), api);

    expect(result).toEqual({ canceled: false, filePath: "C:/tmp/parchment-mask.png" });
    expect(requests[0]).toMatchObject({
      suggestedFileName: "Parchment mask.png",
      fileFilter: { name: "PNG Image", extensions: ["png"] },
      sidecar: { extension: "json" },
    });
    const decoded = await decodeMaskPngBytes(joinChunksForPart(chunks, "primary"));
    expect(Array.from(decoded.values)).toEqual([0, 1, 1, 0, 2, 2, 0, 0]);
    const sidecarText = new TextDecoder().decode(joinChunksForPart(chunks, "sidecar"));
    expect(parseMaskSidecarDocumentOrNull(sidecarText)?.name).toBe("Parchment mask");
  });

  it("describes both parts' byte lengths before any bytes move", async () => {
    const { api, chunks, requests } = createFakeSaveApi();
    await exportMaskLayerThroughSaveDialog(buildLayerToExport(), api);
    const request = requests[0] as { primaryByteLength: number; sidecar: { byteLength: number } };
    expect(request.primaryByteLength).toBe(joinChunksForPart(chunks, "primary").byteLength);
    expect(request.sidecar.byteLength).toBe(joinChunksForPart(chunks, "sidecar").byteLength);
  });

  it("splits a part across chunks that respect the chunk ceiling", async () => {
    const { api, chunks } = createFakeSaveApi();
    await exportMaskLayerThroughSaveDialog(buildLayerToExport(), api, 8);
    expect(chunks.length).toBeGreaterThan(2);
    expect(Math.max(...chunks.map((chunk) => chunk.bytes.byteLength))).toBeLessThanOrEqual(8);
  });

  it("reports a cancelled dialog without uploading anything", async () => {
    const { api, chunks } = createFakeSaveApi({
      beginSaveImage: vi.fn(async () => ({ status: "canceled" }) as const),
    });
    expect(await exportMaskLayerThroughSaveDialog(buildLayerToExport(), api)).toEqual({
      canceled: true,
    });
    expect(chunks).toHaveLength(0);
  });

  it("releases the session when a chunk upload fails", async () => {
    const { api } = createFakeSaveApi({
      sendSaveImageChunk: vi.fn(async () => {
        throw new Error("Error invoking remote method 'image:save-chunk': Error: disk full");
      }),
    });
    await expect(exportMaskLayerThroughSaveDialog(buildLayerToExport(), api)).rejects.toThrow(
      "disk full",
    );
    expect(api.releaseSaveImage).toHaveBeenCalledWith({ token: "token-1" });
  });
});

describe("buildSuggestedMaskFileName", () => {
  it("cleans characters a file name cannot hold", () => {
    expect(buildSuggestedMaskFileName("ink/paper: layer")).toBe("ink-paper- layer.png");
  });

  it("falls back when the layer name cleans away to nothing", () => {
    expect(buildSuggestedMaskFileName("   ")).toBe("mask.png");
  });
});
