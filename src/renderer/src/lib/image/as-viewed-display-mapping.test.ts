import { describe, expect, it } from "vitest";

import {
  DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE,
  buildAsViewedRgbaBytesFromRaster,
  mapRgbaBytesThroughDisplayNormalizationInPlace,
  resolveAsViewedNormalizationForSource,
  type ViewportDisplayMappingState,
} from "@/lib/image/as-viewed-display-mapping";
import type { RasterImage } from "@/lib/image/raster-image";

// CT-296: these are the CPU mirror of what the viewport shows. The oracle for
// every case is "what does the shader put on screen for this sample", so the
// expectations are written as explicit byte values, never as a re-run of the
// implementation.

const NORMALIZED_VIEWING: ViewportDisplayMappingState = {
  normalizationEnabled: true,
  floatDisplayUsesFixedUnitWindow: false,
};

const FIXED_UNIT_FLOAT_WINDOW: ViewportDisplayMappingState = {
  normalizationEnabled: false,
  floatDisplayUsesFixedUnitWindow: true,
};

describe("buildAsViewedRgbaBytesFromRaster for an integer composite", () => {
  // Three 12-bit ramps in a uint16 container, the CT-278 composite shape.
  const composite = buildUint16CompositeRaster(
    [100, 250],
    [800, 950],
    [1600, 1750],
  );

  it("maps each channel over the uint16 data-type range by default", () => {
    const rgba = buildAsViewedRgbaBytesFromRaster(
      composite,
      0,
      DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE,
    );
    // round(value * 255 / 65535): 100 -> 0, 800 -> 3, 1600 -> 6, and the ramp
    // tops at 250 -> 1, 950 -> 4, 1750 -> 7. Dim, exactly as it renders.
    expect(Array.from(rgba)).toEqual([0, 3, 6, 255, 1, 4, 7, 255]);
  });

  it("stretches each channel from its OWN extents with normalized viewing on", () => {
    const rgba = buildAsViewedRgbaBytesFromRaster(composite, 0, NORMALIZED_VIEWING);
    expect(Array.from(rgba)).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });

  it("gives a flat channel black rather than dividing by a zero range", () => {
    const flatBlue = buildUint16CompositeRaster([100, 250], [800, 950], [1600, 1600]);
    const rgba = buildAsViewedRgbaBytesFromRaster(flatBlue, 0, NORMALIZED_VIEWING);
    expect([rgba[2], rgba[6]]).toEqual([0, 0]);
  });
});

describe("buildAsViewedRgbaBytesFromRaster for a grayscale band", () => {
  // A sub-range band: 12-bit values sitting low in a uint16 container.
  const stack = buildUint16GrayscaleStack([0, 100, 200], [1000, 2000, 4000]);

  it("replicates the selected band across R, G and B over the type range", () => {
    const rgba = buildAsViewedRgbaBytesFromRaster(
      stack,
      1,
      DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE,
    );
    // round(1000 * 255 / 65535) = 4, 2000 -> 8, 4000 -> 16.
    expect(Array.from(rgba)).toEqual([4, 4, 4, 255, 8, 8, 8, 255, 16, 16, 16, 255]);
  });

  it("stretches the selected band's own min/max with normalized viewing on", () => {
    const rgba = buildAsViewedRgbaBytesFromRaster(stack, 1, NORMALIZED_VIEWING);
    // 1000 -> 0, 2000 -> round(255/3) = 85, 4000 -> 255.
    expect(Array.from(rgba)).toEqual([0, 0, 0, 255, 85, 85, 85, 255, 255, 255, 255, 255]);
  });

  it("follows the band selection, so a different band gives different pixels", () => {
    const rgba = buildAsViewedRgbaBytesFromRaster(stack, 0, NORMALIZED_VIEWING);
    expect(Array.from(rgba)).toEqual([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
  });
});

describe("buildAsViewedRgbaBytesFromRaster for a float band", () => {
  it("auto-fits the display window to out-of-range float data", () => {
    const raster = buildFloat32SingleBandRaster([-4, 0, 12]);
    const rgba = buildAsViewedRgbaBytesFromRaster(
      raster,
      0,
      DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE,
    );
    // The auto-fit window is [-4, 12]: -4 -> 0, 0 -> round(255/4) = 64, 12 -> 255.
    expect(Array.from(rgba)).toEqual([0, 0, 0, 255, 64, 64, 64, 255, 255, 255, 255, 255]);
  });

  it("clamps to the fixed [0, 1] window when the user pins it", () => {
    const raster = buildFloat32SingleBandRaster([-4, 0.5, 12]);
    const rgba = buildAsViewedRgbaBytesFromRaster(raster, 0, FIXED_UNIT_FLOAT_WINDOW);
    expect(Array.from(rgba)).toEqual([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
  });

  it("passes an in-range float band through the fixed window untouched", () => {
    const raster = buildFloat32SingleBandRaster([0, 0.5, 1]);
    const rgba = buildAsViewedRgbaBytesFromRaster(
      raster,
      0,
      DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE,
    );
    expect(Array.from(rgba)).toEqual([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
  });
});

describe("resolveAsViewedNormalizationForSource", () => {
  it("leaves an integer stack unnormalized by default", () => {
    const raster = buildUint16GrayscaleStack([1000, 2000]);
    const normalization = resolveAsViewedNormalizationForSource(
      { kind: "raster", raster },
      0,
      DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE,
    );
    expect(normalization.enabled).toBe(false);
  });

  it("auto-enables for out-of-range float data unless the fixed window is pinned", () => {
    const source = { kind: "raster", raster: buildFloat32SingleBandRaster([-4, 12]) } as const;
    expect(
      resolveAsViewedNormalizationForSource(source, 0, DEFAULT_VIEWPORT_DISPLAY_MAPPING_STATE)
        .enabled,
    ).toBe(true);
    expect(resolveAsViewedNormalizationForSource(source, 0, FIXED_UNIT_FLOAT_WINDOW).enabled).toBe(
      false,
    );
  });
});

describe("mapRgbaBytesThroughDisplayNormalizationInPlace", () => {
  it("returns the bytes untouched when normalization is off", () => {
    const rgba = Uint8ClampedArray.from([10, 20, 30, 255]);
    const mapped = mapRgbaBytesThroughDisplayNormalizationInPlace(rgba, {
      enabled: false,
      extents: { min: [0, 0, 0], max: [1, 1, 1] },
    });
    expect(Array.from(mapped)).toEqual([10, 20, 30, 255]);
  });

  it("stretches each channel between its extents when normalization is on", () => {
    const rgba = Uint8ClampedArray.from([100, 100, 100, 255, 200, 200, 200, 255]);
    const mapped = mapRgbaBytesThroughDisplayNormalizationInPlace(rgba, {
      enabled: true,
      extents: { min: [100 / 255, 0, 100 / 255], max: [200 / 255, 1, 200 / 255] },
    });
    expect(Array.from(mapped)).toEqual([0, 100, 0, 255, 255, 200, 255, 255]);
  });
});

function buildUint16CompositeRaster(
  red: ReadonlyArray<number>,
  green: ReadonlyArray<number>,
  blue: ReadonlyArray<number>,
): RasterImage {
  return {
    ...buildUint16GrayscaleStack(red, green, blue),
    colorInterpretation: "rgb",
  };
}

function buildUint16GrayscaleStack(...bands: ReadonlyArray<ReadonlyArray<number>>): RasterImage {
  return {
    width: bands[0]!.length,
    height: 1,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: bands.length,
    bandPixels: bands.map((band) => Uint16Array.from(band)),
  };
}

function buildFloat32SingleBandRaster(values: ReadonlyArray<number>): RasterImage {
  return {
    width: values.length,
    height: 1,
    bitsPerSample: 32,
    sampleFormat: "float",
    bandCount: 1,
    bandPixels: [Float32Array.from(values)],
  };
}
