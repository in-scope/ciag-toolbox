import { describe, expect, it, vi } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";
import type { MaskLayer } from "@/lib/masks/mask-layer";
import type { BusyEntryHandle, BusyEntryRegistrar } from "@/state/busy-state-context";

import { computeCnrScoresShowingPanelBusy } from "./run-cnr-analysis";

// The stack: three 2x2 bands under mask [1, 1, 2, 2], so band N scores
// abs(mean of pixels 0..1 - mean of pixels 2..3) / population std of 2..3 (CT-322).

function buildThreeBandRaster(): RasterImage {
  const bands = [
    Float32Array.from([10, 20, 30, 40]),
    Float32Array.from([4, 8, 10, 20]),
    Float32Array.from([100, 100, 0, 10]),
  ];
  return {
    bandPixels: bands,
    width: 2,
    height: 2,
    bitsPerSample: 32,
    sampleFormat: "float",
    bandCount: bands.length,
  };
}

function buildMaskLayer(): MaskLayer {
  return {
    id: "mask-1",
    name: "Parchment mask",
    width: 2,
    height: 2,
    values: Uint8Array.from([1, 1, 2, 2]),
    categories: [
      { id: "category-1", name: "Parchment", color: "#ef4444" },
      { id: "category-2", name: "Substrate", color: "#3b82f6" },
    ],
    opacityPercent: 50,
  };
}

interface RecordedBusyEntry {
  readonly handle: BusyEntryHandle;
  readonly progressUpdates: number[];
  readonly clearCount: () => number;
  readonly requestStop: () => void;
}

function buildRecordingBusyRegistrar(): {
  readonly registrar: BusyEntryRegistrar;
  readonly entry: RecordedBusyEntry;
} {
  const progressUpdates: number[] = [];
  let cleared = 0;
  let stop = (): void => {};
  const handle: BusyEntryHandle = {
    id: "busy-1",
    update: (next) => {
      if (typeof next.progress === "number") progressUpdates.push(next.progress);
    },
    clear: () => {
      cleared += 1;
    },
  };
  const registrar: BusyEntryRegistrar = {
    registerAppBusyEntry: () => handle,
    registerViewportBusyEntry: (input) => {
      stop = input.requestStop ?? (() => {});
      return handle;
    },
  };
  return {
    registrar,
    entry: {
      handle,
      progressUpdates,
      clearCount: () => cleared,
      requestStop: () => stop(),
    },
  };
}

function buildRequest() {
  return {
    raster: buildThreeBandRaster(),
    maskLayer: buildMaskLayer(),
    textCategoryValue: 1,
    backgroundCategoryValue: 2,
  };
}

describe("computeCnrScoresShowingPanelBusy", () => {
  it("returns one score per band, in band order", async () => {
    const busy = buildRecordingBusyRegistrar();
    const outcome = await computeCnrScoresShowingPanelBusy(buildRequest(), {
      busyRegistrar: busy.registrar,
      viewportIndex: 0,
      stopController: new AbortController(),
    });
    expect(outcome.status).toBe("computed");
    if (outcome.status !== "computed") return;
    expect(outcome.scores).toHaveLength(3);
    expect(outcome.scores[0]).toBeCloseTo(4, 12);
    expect(outcome.scores[1]).toBeCloseTo(1.8, 12);
  });

  it("reports a determinate bar from 0 to 1 and clears the busy entry", async () => {
    const busy = buildRecordingBusyRegistrar();
    await computeCnrScoresShowingPanelBusy(buildRequest(), {
      busyRegistrar: busy.registrar,
      viewportIndex: 0,
      stopController: new AbortController(),
    });
    expect(busy.entry.progressUpdates).toEqual([0, 1 / 3, 2 / 3, 1]);
    expect(busy.entry.clearCount()).toBe(1);
  });

  // The busy card's Stop aborts the controller; the next band boundary throws
  // OperationStoppedError, which the flow reports as "stopped", not a failure.
  it("stops between bands when the busy entry's Stop is pressed", async () => {
    const busy = buildRecordingBusyRegistrar();
    const stopController = new AbortController();
    const pending = computeCnrScoresShowingPanelBusy(buildRequest(), {
      busyRegistrar: busy.registrar,
      viewportIndex: 0,
      stopController,
    });
    busy.entry.requestStop();
    expect((await pending).status).toBe("stopped");
    expect(busy.entry.clearCount()).toBe(1);
  });

  it("reports a failure message when a chosen category has no painted pixels", async () => {
    const busy = buildRecordingBusyRegistrar();
    const outcome = await computeCnrScoresShowingPanelBusy(
      { ...buildRequest(), backgroundCategoryValue: 4 },
      {
        busyRegistrar: busy.registrar,
        viewportIndex: 0,
        stopController: new AbortController(),
      },
    );
    expect(outcome).toEqual({
      status: "failed",
      message: "A CNR category has no painted pixels.",
    });
  });

  it("registers the busy entry against the panel that asked for the scores", async () => {
    const registerViewportBusyEntry = vi.fn(() => ({
      id: "busy-1",
      update: () => {},
      clear: () => {},
    }));
    await computeCnrScoresShowingPanelBusy(buildRequest(), {
      busyRegistrar: {
        registerAppBusyEntry: () => ({ id: "busy-0", update: () => {}, clear: () => {} }),
        registerViewportBusyEntry,
      },
      viewportIndex: 2,
      stopController: new AbortController(),
    });
    expect(registerViewportBusyEntry).toHaveBeenCalledWith(
      expect.objectContaining({ viewportIndex: 2, label: "Running analysis..." }),
    );
  });
});
