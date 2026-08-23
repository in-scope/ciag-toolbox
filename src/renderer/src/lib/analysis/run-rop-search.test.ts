import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";
import { createMaskLayer, type MaskLayer } from "@/lib/masks/mask-layer";
import type { UserScriptRunChunkedApi } from "@/lib/python/run-user-script-chunked";
import type { BusyEntryHandle, BusyEntryRegistrar } from "@/state/busy-state-context";

import type { RopSearchRunRequest } from "./rop-search-request";
import { searchBestRopProjectionShowingPanelBusy } from "./run-rop-search";

function buildSilentBusyRegistrar(): BusyEntryRegistrar {
  const handle: BusyEntryHandle = { id: "busy-1", update: () => {}, clear: () => {} };
  return { registerAppBusyEntry: () => handle, registerViewportBusyEntry: () => handle };
}

function buildTwoPixelStack(): RasterImage {
  return {
    bandPixels: [Uint16Array.from([5, 6])],
    width: 2,
    height: 1,
    bandCount: 1,
    sampleFormat: "uint",
    bitsPerSample: 16,
  };
}

function buildTwoCategoryLayer(): MaskLayer {
  const layer = createMaskLayer("mask-1", "Labels", 2, 1);
  return { ...layer, values: Uint8Array.from([1, 2]) };
}

function buildSearchRequest(overrides: Partial<RopSearchRunRequest> = {}): RopSearchRunRequest {
  return {
    seed: 20260822,
    projectionCount: 50,
    objectiveKind: "cnr",
    maskLayer: buildTwoCategoryLayer(),
    npcBinCount: 255,
    cnrTextCategoryValue: 1,
    cnrBackgroundCategoryValue: 2,
    customObjectiveSource: null,
    ...overrides,
  };
}

interface RecordedSearchRun {
  beginRequests: ToolboxUserScriptRunBeginRequest[];
  executeParams: unknown[];
  releasedCount: number;
}

function buildWinnerServingApi(
  winnerValues: number[],
  recorded: RecordedSearchRun,
): UserScriptRunChunkedApi {
  const resultBytes = new Uint8Array(Float32Array.from(winnerValues).buffer.slice(0));
  return {
    beginUserScriptRun: (request) => {
      recorded.beginRequests.push(request);
      return Promise.resolve({ status: "ready", token: "tok", sourceName: null });
    },
    sendUserScriptRunCubeChunk: () => Promise.resolve(),
    executeUserScriptRun: (request) => {
      recorded.executeParams.push(request.params);
      return Promise.resolve({
        status: "completed-cube",
        shape: [1, 1, winnerValues.length] as [number, number, number],
        totalBytes: resultBytes.byteLength,
      });
    },
    readUserScriptRunResultChunk: () => Promise.resolve({ done: true, bytes: resultBytes.slice() }),
    releaseUserScriptRun: () => {
      recorded.releasedCount += 1;
      return Promise.resolve();
    },
    cancelUserScriptRun: () => Promise.resolve(),
  };
}

function buildRecordedSearchRun(): RecordedSearchRun {
  return { beginRequests: [], executeParams: [], releasedCount: 0 };
}

function searchBindings() {
  return { busyRegistrar: buildSilentBusyRegistrar(), viewportIndex: 0 };
}

describe("searchBestRopProjectionShowingPanelBusy", () => {
  it("runs the search as ONE built-in execute and returns the winning band", async () => {
    const recorded = buildRecordedSearchRun();
    const api = buildWinnerServingApi([-3.5, 8.25], recorded);

    const outcome = await searchBestRopProjectionShowingPanelBusy(
      buildSearchRequest(),
      buildTwoPixelStack(),
      searchBindings(),
      api,
    );

    expect(outcome).toEqual({ status: "searched", values: Float32Array.from([-3.5, 8.25]) });
    expect(recorded.executeParams).toHaveLength(1);
    expect(recorded.beginRequests[0]?.source).toEqual({
      mode: "builtin",
      scriptName: "rop_search",
    });
    expect(recorded.releasedCount).toBe(1);
  });

  it("sends the candidate count, the objective, and the category masks with the run", async () => {
    const recorded = buildRecordedSearchRun();
    const api = buildWinnerServingApi([1, 2], recorded);

    await searchBestRopProjectionShowingPanelBusy(
      buildSearchRequest(),
      buildTwoPixelStack(),
      searchBindings(),
      api,
    );

    expect(recorded.executeParams[0]).toMatchObject({
      seed: 20260822,
      count: 50,
      objective: "cnr",
      text_mask_index: 0,
      background_mask_index: 1,
    });
    expect(recorded.beginRequests[0]?.masks).toEqual({ count: 2 });
  });

  it("reports a stopped search, with nothing to deliver", async () => {
    const recorded = buildRecordedSearchRun();
    const api = buildWinnerServingApi([1, 2], recorded);
    api.executeUserScriptRun = () =>
      Promise.resolve({ status: "failed", message: "The script run was stopped." });
    api.cancelUserScriptRun = () => Promise.resolve();

    const controller = new AbortController();
    controller.abort();
    const outcome = await searchBestRopProjectionShowingPanelBusy(
      buildSearchRequest(),
      buildTwoPixelStack(),
      { ...searchBindings(), stopController: controller },
      api,
    );

    expect(outcome).toEqual({ status: "stopped" });
  });

  it("reports a failed search with the script's message", async () => {
    const recorded = buildRecordedSearchRun();
    const api = buildWinnerServingApi([1, 2], recorded);
    api.executeUserScriptRun = () =>
      Promise.resolve({ status: "failed", message: "No projection produced a finite score." });

    const outcome = await searchBestRopProjectionShowingPanelBusy(
      buildSearchRequest(),
      buildTwoPixelStack(),
      searchBindings(),
      api,
    );

    expect(outcome).toEqual({
      status: "failed",
      message: "No projection produced a finite score.",
    });
  });
});
