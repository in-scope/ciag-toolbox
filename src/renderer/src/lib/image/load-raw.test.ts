import { afterEach, describe, expect, it, vi } from "vitest";

import { loadRawAsRaster } from "@/lib/image/load-raw";

interface FakeLibRawSettings {
  readonly useCameraWb?: boolean;
  readonly outputBps?: number;
  readonly outputColor?: number;
}

const captureLatestOpenSettings = { current: undefined as FakeLibRawSettings | undefined };

vi.mock("libraw-wasm", () => {
  return { default: createFakeLibRawConstructor() };
});

function createFakeLibRawConstructor(): new () => unknown {
  return class FakeLibRaw {
    async open(_bytes: Uint8Array, settings: FakeLibRawSettings): Promise<void> {
      captureLatestOpenSettings.current = settings;
      const fakeStateOrNull = readGloballyConfiguredFakeState();
      if (!fakeStateOrNull) throw new Error("Fake LibRaw not configured for test");
      if (fakeStateOrNull.openShouldReject) throw new Error("simulated open failure");
    }
    async metadata(): Promise<Record<string, unknown>> {
      return readGloballyConfiguredFakeStateOrThrow().metadata;
    }
    async imageData(): Promise<unknown> {
      return readGloballyConfiguredFakeStateOrThrow().imageData;
    }
  };
}

interface FakeLibRawState {
  readonly metadata: Record<string, unknown>;
  readonly imageData: unknown;
  readonly openShouldReject?: boolean;
}

const FAKE_LIBRAW_STATE_KEY = "__fakeLibRawState";

function configureFakeLibRawState(state: FakeLibRawState): void {
  (globalThis as Record<string, unknown>)[FAKE_LIBRAW_STATE_KEY] = state;
}

function readGloballyConfiguredFakeState(): FakeLibRawState | null {
  return ((globalThis as Record<string, unknown>)[FAKE_LIBRAW_STATE_KEY] as FakeLibRawState) ?? null;
}

function readGloballyConfiguredFakeStateOrThrow(): FakeLibRawState {
  const state = readGloballyConfiguredFakeState();
  if (!state) throw new Error("Fake LibRaw not configured for test");
  return state;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[FAKE_LIBRAW_STATE_KEY];
  captureLatestOpenSettings.current = undefined;
});

describe("loadRawAsRaster", () => {
  it("opens libraw with camera-WB and 16 bps output settings", async () => {
    configureFakeLibRawState({
      metadata: { width: 2, height: 2, bits: 16, colors: 3 },
      imageData: buildInterleavedTwoByTwoSixteenBitRgb(),
    });
    await loadRawAsRaster(Uint8Array.of(1, 2, 3, 4));
    expect(captureLatestOpenSettings.current?.useCameraWb).toBe(true);
    expect(captureLatestOpenSettings.current?.outputBps).toBe(16);
  });

  it("decodes a 2x2 RGB16 image into three 16-bit per-band Uint16Arrays", async () => {
    configureFakeLibRawState({
      metadata: { width: 2, height: 2, bits: 16, colors: 3 },
      imageData: buildInterleavedTwoByTwoSixteenBitRgb(),
    });
    const raster = await loadRawAsRaster(Uint8Array.of(1, 2, 3, 4));
    expect(raster.width).toBe(2);
    expect(raster.height).toBe(2);
    expect(raster.bandCount).toBe(3);
    expect(raster.bitsPerSample).toBe(16);
    expect(raster.sampleFormat).toBe("uint");
    expect(raster.bandPixels[0]).toBeInstanceOf(Uint16Array);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([10, 40, 70, 100]);
    expect(Array.from(raster.bandPixels[1]!)).toEqual([20, 50, 80, 110]);
    expect(Array.from(raster.bandPixels[2]!)).toEqual([30, 60, 90, 120]);
  });

  it("accepts a libraw_processed_image_t-shaped object as image data", async () => {
    configureFakeLibRawState({
      metadata: {},
      imageData: {
        width: 1,
        height: 1,
        bits: 8,
        colors: 3,
        data: Uint8Array.of(7, 8, 9),
      },
    });
    const raster = await loadRawAsRaster(Uint8Array.of(1));
    expect(raster.bitsPerSample).toBe(8);
    expect(raster.bandPixels[0]).toBeInstanceOf(Uint8Array);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([7]);
    expect(Array.from(raster.bandPixels[1]!)).toEqual([8]);
    expect(Array.from(raster.bandPixels[2]!)).toEqual([9]);
  });

  it("labels the three bands Red, Green, Blue", async () => {
    configureFakeLibRawState({
      metadata: { width: 1, height: 1, bits: 16, colors: 3 },
      imageData: Uint16Array.of(100, 200, 300),
    });
    const raster = await loadRawAsRaster(Uint8Array.of(1));
    expect(raster.bandLabels).toEqual(["Red", "Green", "Blue"]);
  });

  it("rejects non-RGB output (e.g. four-colour)", async () => {
    configureFakeLibRawState({
      metadata: { width: 1, height: 1, bits: 16, colors: 4 },
      imageData: Uint16Array.of(1, 2, 3, 4),
    });
    await expect(loadRawAsRaster(Uint8Array.of(1))).rejects.toThrow(/3-channel RGB/);
  });

  it("surfaces a user-readable error when libraw cannot open the file", async () => {
    configureFakeLibRawState({
      metadata: {},
      imageData: new Uint8Array(0),
      openShouldReject: true,
    });
    await expect(loadRawAsRaster(Uint8Array.of(1, 2))).rejects.toThrow(
      /Could not decode raw camera file/,
    );
  });
});

function buildInterleavedTwoByTwoSixteenBitRgb(): Uint16Array {
  return Uint16Array.of(10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120);
}
