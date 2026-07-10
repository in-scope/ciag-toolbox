import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

import {
  runSaveProjectBundleFlowThroughMainProcess,
  type SaveBundleFlowApi,
  type SaveBundleFlowInput,
} from "./run-save-bundle-flow";
import type { SaveableProjectSnapshot } from "./serialize-project";

interface FakeApiRecord {
  begins: ToolboxSaveBundleBeginRequest[];
  chunks: ToolboxSaveBundleAssetChunkRequest[];
  finishedTokens: string[];
  releasedTokens: string[];
}

interface FakeApiBehavior {
  begin?: ToolboxSaveBundleBeginResult;
  failChunkWith?: Error;
  failFinishWith?: Error;
}

function buildFakeApi(behavior: FakeApiBehavior = {}): { api: SaveBundleFlowApi; record: FakeApiRecord } {
  const record: FakeApiRecord = { begins: [], chunks: [], finishedTokens: [], releasedTokens: [] };
  const api: SaveBundleFlowApi = {
    beginSaveProjectBundle: (request) => {
      record.begins.push(request);
      return Promise.resolve(behavior.begin ?? { status: "ready", token: "tok" });
    },
    sendSaveProjectBundleAssetChunk: (request) => {
      if (behavior.failChunkWith) return Promise.reject(behavior.failChunkWith);
      record.chunks.push(request);
      return Promise.resolve();
    },
    finishSaveProjectBundle: (request) => {
      record.finishedTokens.push(request.token);
      if (behavior.failFinishWith) return Promise.reject(behavior.failFinishWith);
      return Promise.resolve({ filePath: "/out/saved.ctbundle" });
    },
    releaseSaveProjectBundle: (request) => {
      record.releasedTokens.push(request.token);
      return Promise.resolve();
    },
  };
  return { api, record };
}

function buildModifiedMultiBandSnapshot(): SaveableProjectSnapshot {
  return {
    gridLayout: "1x1",
    selectedViewportIndices: [0],
    viewports: [
      {
        index: 0,
        fileName: "cube.hdr",
        source: buildMultiBandRasterSource(),
        originalFilePath: "/abs/cube.hdr",
        renderingState: {
          normalizationEnabled: false,
          selectedBandIndex: 0,
          lastAppliedOperationLabel: "Invert",
        },
        operationHistory: [
          {
            actionId: "invert",
            actionLabel: "Invert",
            appliedLabel: "Invert (all bands)",
            parameterValues: { allBands: true },
            timestampMs: 1_700_000_000_000,
          },
        ],
      },
    ],
  };
}

function buildMultiBandRasterSource(): ViewportImageSource {
  const raster: RasterImage = {
    bandPixels: [
      new Uint16Array([0, 1, 2, 3]),
      new Uint16Array([4, 5, 6, 7]),
    ],
    width: 2,
    height: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 2,
    sourceInterleave: "bsq",
  };
  return { kind: "raster", raster };
}

function flowInput(
  onProgress?: SaveBundleFlowInput["onProgress"],
): SaveBundleFlowInput {
  return {
    snapshot: buildModifiedMultiBandSnapshot(),
    currentProjectFilePath: null,
    saveAs: false,
    onProgress,
  };
}

describe("runSaveProjectBundleFlowThroughMainProcess", () => {
  it("sends a byte-free header, uploads baked parts in chunk-size pieces, and finishes", async () => {
    const { api, record } = buildFakeApi();
    const result = await runSaveProjectBundleFlowThroughMainProcess(flowInput(), api, 7);
    expect(result).toEqual({ canceled: false, filePath: "/out/saved.ctbundle" });
    const headerAsset = record.begins[0]?.header.viewports[0]?.asset;
    expect(headerAsset?.kind).toBe("baked");
    expect(record.chunks.every((chunk) => chunk.bytes.byteLength <= 7)).toBe(true);
    expect(sumOfUploadedBytes(record)).toBe(totalDeclaredBakedBytes(record));
    expect(record.finishedTokens).toEqual(["tok"]);
    expect(record.releasedTokens).toEqual([]);
  });

  it("returns canceled without uploading anything when the begin dialog cancels", async () => {
    const { api, record } = buildFakeApi({ begin: { status: "canceled" } });
    const result = await runSaveProjectBundleFlowThroughMainProcess(flowInput(), api, 7);
    expect(result).toEqual({ canceled: true });
    expect(record.chunks).toHaveLength(0);
    expect(record.finishedTokens).toHaveLength(0);
  });

  it("reports monotonic determinate progress from 0 to 1", async () => {
    const { api } = buildFakeApi();
    const fractions: number[] = [];
    await runSaveProjectBundleFlowThroughMainProcess(
      flowInput((event) => fractions.push(event.fraction)),
      api,
      7,
    );
    expect(fractions[0]).toBe(0);
    expect(fractions[fractions.length - 1]).toBe(1);
    expect(fractions.length).toBeGreaterThan(3);
    expect([...fractions].sort((a, b) => a - b)).toEqual(fractions);
  });

  it("releases the session and rethrows a stripped message when a chunk upload fails", async () => {
    const wrapped = new Error(
      "Error invoking remote method 'project:save-bundle-asset-chunk': Error: The packed stack bytes did not match the described size.",
    );
    const { api, record } = buildFakeApi({ failChunkWith: wrapped });
    await expect(runSaveProjectBundleFlowThroughMainProcess(flowInput(), api, 7)).rejects.toThrow(
      "The packed stack bytes did not match the described size.",
    );
    expect(record.releasedTokens).toEqual(["tok"]);
    expect(record.finishedTokens).toHaveLength(0);
  });

  it("releases the session and surfaces the message when finish fails (e.g. disk full)", async () => {
    const { api, record } = buildFakeApi({
      failFinishWith: new Error(
        "Error invoking remote method 'project:save-bundle-finish': Error: ENOSPC: no space left on device",
      ),
    });
    await expect(runSaveProjectBundleFlowThroughMainProcess(flowInput(), api, 7)).rejects.toThrow(
      /ENOSPC/,
    );
    expect(record.releasedTokens).toEqual(["tok"]);
  });
});

function sumOfUploadedBytes(record: FakeApiRecord): number {
  return record.chunks.reduce((sum, chunk) => sum + chunk.bytes.byteLength, 0);
}

function totalDeclaredBakedBytes(record: FakeApiRecord): number {
  return record.begins[0]!.header.viewports.reduce((sum, viewport) => {
    if (viewport.asset.kind !== "baked") return sum;
    return sum + viewport.asset.primary.byteLength + (viewport.asset.sidecar?.byteLength ?? 0);
  }, 0);
}
