import { expect, test } from "@playwright/test";

import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  expectAxisLabelIsSuperscriptCount,
  expectHistogramBarsMeetWithoutGaps,
  expectHistogramShowsEmptyMiddleBins,
  expectLabelsCoverLargeAndSmallSuperscripts,
  expectLabelsUseSuperscriptNotMachineNotation,
  histogramCanvas,
  loadImageFromAbsolutePath,
  pinPixelSpectrum,
  readAllChartAxisLabels,
  readHistogramCountAxisLabels,
  readHistogramValueAxisLabels,
  readMetadata,
  writeTemporaryMultiBandFloat32Tiff,
  writeTemporaryMultiBandUint16Tiff,
  writeTemporarySingleBandUint16Tiff,
} from "./support/page-objects";

// CT-156 / CT-100 / manual test script section 26: chart axis polish.
//
// 1. Superscript magnitudes (26.1-26.2): large AND small axis values render as
//    scientific notation with a real superscript exponent ("6.000×10⁴", "4.000×10⁻⁷"),
//    never machine notation ("6.6e+4"). The histogram value axis only reaches these
//    magnitudes on a FLOAT band (integer histograms span the data-type container range,
//    whose endpoints are plain integers), so this drives a purpose-built float stack
//    whose band min/max are a tiny and a huge magnitude.
// 2. Histogram y-axis pixel counts (26.3): the count axis labels real pixel counts; a
//    uniform stack of >10000 pixels in one bin shows the count in superscript form.
// 3. Bar gaps (26.4-26.5): adjacent non-empty bars meet seamlessly (no hairline
//    stripes), while genuinely empty bins still render empty. A dense stack filling
//    every bin paints one contiguous run; a bimodal stack leaves a real empty middle.

const PANEL = 1;
const SMALL_MAGNITUDE = 4e-7;
const LARGE_MAGNITUDE = 60000;
const FLOAT_FIXTURE_DIMENSIONS = { width: 4, height: 4 };
const FLOAT_PIXEL_COUNT = FLOAT_FIXTURE_DIMENSIONS.width * FLOAT_FIXTURE_DIMENSIONS.height;
const UINT16_MAX = 65535;
const BIN_COUNT = 256;
const UNIFORM_FILL_PIXELS_PER_AXIS = 128;
const UNIFORM_PEAK_COUNT_LABEL = "1.6×10⁴";

function buildLinearFloatBandValues(start: number, end: number): number[] {
  const lastIndex = FLOAT_PIXEL_COUNT - 1;
  return Array.from({ length: FLOAT_PIXEL_COUNT }, (_unused, index) =>
    start + (end - start) * (index / lastIndex),
  );
}

function buildDenseGradientFillingEveryBin(): number[] {
  return Array.from({ length: BIN_COUNT }, (_unused, index) => index * (UINT16_MAX + 1) / BIN_COUNT);
}

function buildBimodalLowAndHighClusters(): number[] {
  return Array.from({ length: BIN_COUNT }, (_unused, index) =>
    index < BIN_COUNT / 2 ? 0 : UINT16_MAX,
  );
}

async function writeFloatSuperscriptFixture(): Promise<string> {
  return writeTemporaryMultiBandFloat32Tiff({
    ...FLOAT_FIXTURE_DIMENSIONS,
    bands: [
      buildLinearFloatBandValues(SMALL_MAGNITUDE, LARGE_MAGNITUDE),
      buildLinearFloatBandValues(LARGE_MAGNITUDE, SMALL_MAGNITUDE),
    ],
  });
}

test.describe("CT-156: superscript scientific notation on chart axes", () => {
  let launched: LaunchedApp;

  test.beforeAll(async () => {
    launched = await launchToolboxApp();
    await loadImageFromAbsolutePath(launched.window, await writeFloatSuperscriptFixture());
    await expect(histogramCanvas(launched.window)).toBeVisible();
  });

  test.afterAll(async () => {
    await closeToolboxApp(launched);
  });

  test("loads as a float stack so the axes carry extreme magnitudes", async () => {
    const metadata = await readMetadata(launched.window);
    expect(metadata.dataType).toBe("float32");
    expect(metadata.bandCount).toBe("2");
  });

  test("renders the histogram value axis with large and small superscripts", async () => {
    const labels = await readHistogramValueAxisLabels(launched.window);
    expectLabelsCoverLargeAndSmallSuperscripts(labels);
    expectLabelsUseSuperscriptNotMachineNotation(labels);
  });

  test("renders the pinned spectra plot axes with superscripts and no e+ text", async () => {
    await pinPixelSpectrum(launched.window, PANEL, 0, 0, FLOAT_FIXTURE_DIMENSIONS);
    const labels = await readAllChartAxisLabels(launched.window);
    expectLabelsUseSuperscriptNotMachineNotation(labels);
  });
});

test.describe("CT-156: histogram y-axis labels pixel counts", () => {
  let launched: LaunchedApp;

  test.beforeAll(async () => {
    launched = await launchToolboxApp();
    const fixturePath = await writeTemporarySingleBandUint16Tiff({
      width: UNIFORM_FILL_PIXELS_PER_AXIS,
      height: UNIFORM_FILL_PIXELS_PER_AXIS,
      fillValue: 1000,
    });
    await loadImageFromAbsolutePath(launched.window, fixturePath);
    await expect(histogramCanvas(launched.window)).toBeVisible();
  });

  test.afterAll(async () => {
    await closeToolboxApp(launched);
  });

  test("labels the count axis with the peak pixel count and zero", async () => {
    const labels = await readHistogramCountAxisLabels(launched.window);
    expectAxisLabelIsSuperscriptCount(labels, UNIFORM_PEAK_COUNT_LABEL);
    expectLabelsUseSuperscriptNotMachineNotation(labels);
  });
});

test.describe("CT-156: adjacent histogram bars meet without hairline stripes", () => {
  let launched: LaunchedApp;

  test.beforeAll(async () => {
    launched = await launchToolboxApp();
    const fixturePath = await writeTemporaryMultiBandUint16Tiff({
      width: 16,
      height: 16,
      bands: [buildDenseGradientFillingEveryBin()],
    });
    await loadImageFromAbsolutePath(launched.window, fixturePath);
    await expect(histogramCanvas(launched.window)).toBeVisible();
  });

  test.afterAll(async () => {
    await closeToolboxApp(launched);
  });

  test("paints one contiguous run when every bin is populated", async () => {
    await expectHistogramBarsMeetWithoutGaps(histogramCanvas(launched.window));
  });
});

test.describe("CT-156: genuinely empty histogram bins still render empty", () => {
  let launched: LaunchedApp;

  test.beforeAll(async () => {
    launched = await launchToolboxApp();
    const fixturePath = await writeTemporaryMultiBandUint16Tiff({
      width: 16,
      height: 16,
      bands: [buildBimodalLowAndHighClusters()],
    });
    await loadImageFromAbsolutePath(launched.window, fixturePath);
    await expect(histogramCanvas(launched.window)).toBeVisible();
  });

  test.afterAll(async () => {
    await closeToolboxApp(launched);
  });

  test("leaves an empty middle between the two clusters", async () => {
    await expectHistogramShowsEmptyMiddleBins(histogramCanvas(launched.window));
  });
});
