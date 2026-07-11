import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";
import type {
  BusyEntryHandle,
  BusyEntryRegistrar,
  RegisterViewportBusyEntryInput,
} from "@/state/busy-state-context";

import {
  deriveOtsuCutoffsShowingViewportBusyOrNotifyFailure,
  describeOtsuAutoThresholdFailure,
  OTSU_AUTO_BUSY_LABEL,
  type OtsuAutoThresholdFlowBindings,
} from "./otsu-auto-flow";
import type { ThresholdOtsuCutoffs } from "./otsu-cutoffs";

interface RecordedBusyEntry {
  readonly input: RegisterViewportBusyEntryInput;
  readonly progressUpdates: number[];
  cleared: boolean;
}

interface RecordingBusyRegistrar {
  readonly registrar: BusyEntryRegistrar;
  readonly entries: RecordedBusyEntry[];
}

function buildRecordingBusyRegistrar(): RecordingBusyRegistrar {
  const entries: RecordedBusyEntry[] = [];
  const registerViewportBusyEntry = (input: RegisterViewportBusyEntryInput): BusyEntryHandle => {
    const entry: RecordedBusyEntry = { input, progressUpdates: [], cleared: false };
    entries.push(entry);
    return {
      id: `busy-${entries.length}`,
      update: (next) => {
        if (typeof next.progress === "number") entry.progressUpdates.push(next.progress);
      },
      clear: () => {
        entry.cleared = true;
      },
    };
  };
  const registerAppBusyEntry = (): BusyEntryHandle => {
    throw new Error("The Otsu auto flow must register a VIEWPORT busy entry.");
  };
  return { registrar: { registerAppBusyEntry, registerViewportBusyEntry }, entries };
}

function makeSingleBandRaster(): RasterImage {
  return {
    bandPixels: [Uint8Array.from([10, 200])],
    width: 2,
    height: 1,
    bandCount: 1,
    sampleFormat: "uint",
    bitsPerSample: 8,
  };
}

const FAKE_CUTOFFS: ThresholdOtsuCutoffs = {
  perBandBounds: [{ lower: 11, upper: 255 }],
  combinedBounds: { lower: 11, upper: 255 },
};

function buildBindings(
  recording: RecordingBusyRegistrar,
  errors: string[],
  computeCutoffs: OtsuAutoThresholdFlowBindings["computeCutoffs"],
): OtsuAutoThresholdFlowBindings {
  return {
    busyRegistrar: recording.registrar,
    viewportIndex: 3,
    notifyError: (message) => errors.push(message),
    computeCutoffs,
  };
}

describe("deriveOtsuCutoffsShowingViewportBusyOrNotifyFailure", () => {
  it("returns the cutoffs and forwards progress to the viewport busy entry", async () => {
    const recording = buildRecordingBusyRegistrar();
    const errors: string[] = [];
    const bindings = buildBindings(recording, errors, async (_raster, onProgress) => {
      onProgress?.(0);
      onProgress?.(0.5);
      onProgress?.(1);
      return FAKE_CUTOFFS;
    });
    const cutoffs = await deriveOtsuCutoffsShowingViewportBusyOrNotifyFailure(
      bindings,
      makeSingleBandRaster(),
    );
    expect(cutoffs).toEqual(FAKE_CUTOFFS);
    expect(errors).toEqual([]);
    const entry = recording.entries[0]!;
    expect(entry.input).toEqual({ viewportIndex: 3, label: OTSU_AUTO_BUSY_LABEL });
    expect(entry.progressUpdates).toEqual([0, 0.5, 1]);
    expect(entry.cleared).toBe(true);
  });

  it("notifies an injected failure as an error message and returns null", async () => {
    const recording = buildRecordingBusyRegistrar();
    const errors: string[] = [];
    const bindings = buildBindings(recording, errors, async () => {
      throw new Error("Array buffer allocation failed");
    });
    const cutoffs = await deriveOtsuCutoffsShowingViewportBusyOrNotifyFailure(
      bindings,
      makeSingleBandRaster(),
    );
    expect(cutoffs).toBeNull();
    expect(errors).toEqual(["Auto threshold failed: Array buffer allocation failed"]);
    expect(recording.entries[0]!.cleared).toBe(true);
  });

  it("computes real cutoffs when no compute override is injected", async () => {
    const recording = buildRecordingBusyRegistrar();
    const errors: string[] = [];
    const bindings = buildBindings(recording, errors, undefined);
    const cutoffs = await deriveOtsuCutoffsShowingViewportBusyOrNotifyFailure(
      bindings,
      makeSingleBandRaster(),
    );
    expect(cutoffs).toEqual(FAKE_CUTOFFS);
    expect(recording.entries[0]!.cleared).toBe(true);
  });
});

describe("describeOtsuAutoThresholdFailure", () => {
  it("names the failure with the error's message", () => {
    expect(describeOtsuAutoThresholdFailure(new Error("boom"))).toBe(
      "Auto threshold failed: boom",
    );
  });

  it("stringifies a non-Error rejection", () => {
    expect(describeOtsuAutoThresholdFailure("wat")).toBe("Auto threshold failed: wat");
  });
});
