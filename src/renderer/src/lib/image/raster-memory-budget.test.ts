import { afterEach, describe, expect, it } from "vitest";

import {
  assertAllocationFitsRemainingBudget,
  assertRasterAllocationFitsMemoryBudget,
  DUPLICATE_MEMORY_REFUSAL_MESSAGE,
  OPEN_IMAGES_MEMORY_REFUSAL_MESSAGE,
  OPERATION_MEMORY_REFUSAL_MESSAGE,
  rasterAllocationExceedsMemoryBudget,
  remainingRasterMemoryBudgetBytes,
  RENDERER_ARRAY_BUFFER_POOL_BYTES,
  sumLiveRasterBytesAcrossSources,
  USABLE_RASTER_MEMORY_BUDGET_BYTES,
  usableRasterMemoryBudgetBytes,
} from "./raster-memory-budget";
import type { RasterImage } from "./raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

function rasterSourceWithBands(bands: Uint16Array[]): ViewportImageSource {
  const raster: RasterImage = {
    bandPixels: bands,
    width: bands[0]?.length ?? 0,
    height: 1,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: bands.length,
  };
  return { kind: "raster", raster };
}

describe("raster memory budget constants", () => {
  it("keeps the usable budget under the measured pool by the safety margin", () => {
    expect(RENDERER_ARRAY_BUFFER_POOL_BYTES).toBe(17_000_000_000);
    expect(USABLE_RASTER_MEMORY_BUDGET_BYTES).toBeLessThan(RENDERER_ARRAY_BUFFER_POOL_BYTES);
    expect(USABLE_RASTER_MEMORY_BUDGET_BYTES).toBeGreaterThan(14_000_000_000);
  });
});

describe("sumLiveRasterBytesAcrossSources", () => {
  it("sums the band bytes of every raster source", () => {
    const sources = [
      rasterSourceWithBands([new Uint16Array(10), new Uint16Array(10)]),
      rasterSourceWithBands([new Uint16Array(5)]),
    ];
    expect(sumLiveRasterBytesAcrossSources(sources)).toBe(20 + 20 + 10);
  });

  it("counts a band buffer shared between panels exactly once", () => {
    const sharedBand = new Uint16Array(10);
    const sources = [
      rasterSourceWithBands([sharedBand, new Uint16Array(10)]),
      rasterSourceWithBands([sharedBand]),
    ];
    expect(sumLiveRasterBytesAcrossSources(sources)).toBe(20 + 20);
  });

  it("counts aliased bands within one raster exactly once", () => {
    const aliased = new Uint16Array(8);
    expect(sumLiveRasterBytesAcrossSources([rasterSourceWithBands([aliased, aliased])])).toBe(16);
  });

  it("counts pixel sources and ignores browser image sources", () => {
    const pixels: ViewportImageSource = {
      kind: "pixels",
      pixels: new Uint8Array(12),
      width: 4,
      height: 3,
    };
    const htmlImage = { kind: "html-image", image: {} } as unknown as ViewportImageSource;
    expect(sumLiveRasterBytesAcrossSources([pixels, htmlImage])).toBe(12);
  });
});

describe("budget arithmetic", () => {
  it("reports the room left under the usable budget, never negative", () => {
    expect(remainingRasterMemoryBudgetBytes(0)).toBe(USABLE_RASTER_MEMORY_BUDGET_BYTES);
    expect(remainingRasterMemoryBudgetBytes(USABLE_RASTER_MEMORY_BUDGET_BYTES + 1)).toBe(0);
  });

  it("accepts an allocation exactly at the remaining budget and refuses one byte more", () => {
    const liveBytes = 1_000;
    const remaining = USABLE_RASTER_MEMORY_BUDGET_BYTES - liveBytes;
    expect(rasterAllocationExceedsMemoryBudget(remaining, liveBytes)).toBe(false);
    expect(rasterAllocationExceedsMemoryBudget(remaining + 1, liveBytes)).toBe(true);
  });

  it("throws exactly the given refusal message when over budget", () => {
    expect(() =>
      assertRasterAllocationFitsMemoryBudget(
        USABLE_RASTER_MEMORY_BUDGET_BYTES + 1,
        0,
        OPERATION_MEMORY_REFUSAL_MESSAGE,
      ),
    ).toThrow(OPERATION_MEMORY_REFUSAL_MESSAGE);
    expect(() =>
      assertRasterAllocationFitsMemoryBudget(1, 0, OPERATION_MEMORY_REFUSAL_MESSAGE),
    ).not.toThrow();
  });

  it("checks against an explicit remaining budget for the open flows", () => {
    expect(() => assertAllocationFitsRemainingBudget(10, 10, OPEN_IMAGES_MEMORY_REFUSAL_MESSAGE)).not.toThrow();
    expect(() => assertAllocationFitsRemainingBudget(11, 10, OPEN_IMAGES_MEMORY_REFUSAL_MESSAGE)).toThrow(
      OPEN_IMAGES_MEMORY_REFUSAL_MESSAGE,
    );
  });

  it("keeps every refusal message inside the app error vocabulary", () => {
    for (const message of [
      OPERATION_MEMORY_REFUSAL_MESSAGE,
      OPEN_IMAGES_MEMORY_REFUSAL_MESSAGE,
      DUPLICATE_MEMORY_REFUSAL_MESSAGE,
    ]) {
      expect(message).toMatch(/^There is not enough memory/);
      expect(message).toContain("Close panels you no longer need");
      expect(message.toLowerCase()).not.toContain("allocation failed");
    }
  });
});

// CT-260 e2e test surface: the preload's e2e bridge can lower the budget so
// memory refusals are reproducible with tiny fixtures.
describe("e2e memory budget override", () => {
  interface GlobalCarryingWindow {
    window?: { toolboxE2E?: { memoryBudgetOverrideBytes?: number | null } };
  }

  const globalWithWindow = globalThis as GlobalCarryingWindow;

  afterEach(() => {
    delete globalWithWindow.window;
  });

  it("uses the measured budget when no e2e bridge exists", () => {
    expect(usableRasterMemoryBudgetBytes()).toBe(USABLE_RASTER_MEMORY_BUDGET_BYTES);
  });

  it("uses the bridge's lowered budget when present", () => {
    globalWithWindow.window = { toolboxE2E: { memoryBudgetOverrideBytes: 1_000 } };
    expect(usableRasterMemoryBudgetBytes()).toBe(1_000);
    expect(remainingRasterMemoryBudgetBytes(400)).toBe(600);
    expect(rasterAllocationExceedsMemoryBudget(601, 400)).toBe(true);
  });

  it("falls back to the measured budget when the bridge carries no override", () => {
    globalWithWindow.window = { toolboxE2E: { memoryBudgetOverrideBytes: null } };
    expect(usableRasterMemoryBudgetBytes()).toBe(USABLE_RASTER_MEMORY_BUDGET_BYTES);
  });
});
