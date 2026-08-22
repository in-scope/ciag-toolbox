import { expect, test } from "@playwright/test";

import { rgbPng } from "./fixtures/fixture-manifest";
import type { PixelDimensions } from "./support/page-objects";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperationInPlace,
  averageNonClearCanvasColor,
  cancelOperation,
  expectHistoryToRecordOperation,
  expectPixelReadoutToEqual,
  historyEntryCount,
  loadFixtureAsStack,
  openOperation,
  panelCanvas,
  selectPanel,
} from "./support/page-objects";
import {
  applyToAllBandsSwitch,
  BRIGHTNESS_CONTRAST_LABEL,
  BRIGHTNESS_SLIDER_LABEL,
  setBrightnessContrastSlider,
  setLogSymmetricContrastSlider,
} from "./support/brightness-contrast-controls";

// CT-247: Brightness & Contrast on a true-colour composite previews LIVE by remapping
// all three channels through the CT-177 per-channel GPU LUTs, and Apply ALWAYS adjusts
// all three channels (the "Apply to all bands" switch is hidden - the choice would be
// meaningless for a photo). rgb.png (2x2, documented per-pixel R/G/B) is the fixture:
// while the panel is open a slider drag must change the rendered canvas on every channel
// but leave the pixel-readout DATA untouched, and Apply must bake exactly what the
// preview showed. The status bar exposes the selected (Red) band for a composite, so the
// exact data oracle is Red at probe pixel (1,0)=(10,20,30); Green/Blue are verified via
// canvas-pixel sampling (averageNonClearCanvasColor), which after Apply (LUT cleared,
// panel closed) reflects the baked band data - matching the CT-178 oracle pattern.
//
// Exact Red oracle at (1,0) for Brightness +20%, Contrast 1.2 (uint8):
// brightened red band = clamp(v + 51) over {200,10,255,0} -> {251,61,255,51}; CT-297:
// contrast centres on the uint8 data-range MIDPOINT (127.5), not any band mean, so
// round((61 - 127.5) * 1.2 + 127.5) = 48.

const PANEL = 1;
const DIMENSIONS: PixelDimensions = { width: rgbPng.width, height: rgbPng.height };
const PROBE = { x: 1, y: 0 };
const PROBE_RED_BEFORE = 10;
const BRIGHTNESS_PERCENT = 20;
const CONTRAST_RATIO = 1.2;
const PROBE_RED_AFTER = 48;
// Expected channel-average shifts on the 2x2 fixture are +29/+32/+51; assert well below.
const MIN_PREVIEW_CHANNEL_DELTA = 15;
const APPLY_MATCHES_PREVIEW_TOLERANCE = 12;
const CANCEL_BRIGHTNESS_PERCENT = 40;

type CanvasColor = Awaited<ReturnType<typeof averageNonClearCanvasColor>>;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, rgbPng.fileName);
  await selectPanel(launched.window, PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("composite preview remaps all three channels display-only, hides the all-bands switch, and Apply bakes the previewed adjustment", async () => {
  const baseline = await test.step("capture the untouched render and data", async () => {
    await expectProbeRedReadout(PROBE_RED_BEFORE);
    return settledAverageCanvasColor();
  });
  await test.step("open the panel: no Apply to all bands switch for a photo", async () => {
    await openOperation(launched.window, BRIGHTNESS_CONTRAST_LABEL);
    await expect(applyToAllBandsSwitch(launched.window)).toHaveCount(0);
  });
  const preview = await test.step("adjust sliders: all three channels brighten, data unchanged", async () => {
    await setBrightnessContrastSlider(launched.window, BRIGHTNESS_SLIDER_LABEL, BRIGHTNESS_PERCENT);
    await setLogSymmetricContrastSlider(launched.window, CONTRAST_RATIO);
    const previewColor = await expectAllChannelsBrightenedAbove(baseline);
    await expectProbeRedReadout(PROBE_RED_BEFORE);
    expect(await historyEntryCount(launched.window)).toBe(0);
    return previewColor;
  });
  await test.step("Apply bakes exactly what the preview showed on all three channels", async () => {
    await applyOperationInPlace(launched.window, BRIGHTNESS_CONTRAST_LABEL);
    await expectProbeRedReadout(PROBE_RED_AFTER);
    await expectCanvasMatchesPreviewedColor(preview);
    await expectOneAllBandsHistoryEntry();
  });
});

test("closing the panel clears the composite preview and restores the untouched render", async () => {
  const baseline = await settledAverageCanvasColor();
  await openOperation(launched.window, BRIGHTNESS_CONTRAST_LABEL);
  await setBrightnessContrastSlider(launched.window, BRIGHTNESS_SLIDER_LABEL, CANCEL_BRIGHTNESS_PERCENT);
  await expectAllChannelsBrightenedAbove(baseline);
  await cancelOperation(launched.window, BRIGHTNESS_CONTRAST_LABEL);
  await expectCanvasMatchesPreviewedColor(baseline);
  await expectProbeRedReadout(PROBE_RED_BEFORE);
  expect(await historyEntryCount(launched.window)).toBe(0);
});

async function settledAverageCanvasColor(): Promise<CanvasColor> {
  await launched.window.waitForTimeout(200);
  return averageNonClearCanvasColor(panelCanvas(launched.window, PANEL));
}

async function expectAllChannelsBrightenedAbove(baseline: CanvasColor): Promise<CanvasColor> {
  await expect
    .poll(() => averageNonClearCanvasColor(panelCanvas(launched.window, PANEL)).then((c) => c.red))
    .toBeGreaterThan(baseline.red + MIN_PREVIEW_CHANNEL_DELTA);
  const color = await averageNonClearCanvasColor(panelCanvas(launched.window, PANEL));
  expect(color.green).toBeGreaterThan(baseline.green + MIN_PREVIEW_CHANNEL_DELTA);
  expect(color.blue).toBeGreaterThan(baseline.blue + MIN_PREVIEW_CHANNEL_DELTA);
  return color;
}

async function expectCanvasMatchesPreviewedColor(previewed: CanvasColor): Promise<void> {
  await expect
    .poll(async () => {
      const color = await averageNonClearCanvasColor(panelCanvas(launched.window, PANEL));
      return maxChannelDifference(color, previewed);
    })
    .toBeLessThan(APPLY_MATCHES_PREVIEW_TOLERANCE);
}

function maxChannelDifference(a: CanvasColor, b: CanvasColor): number {
  return Math.max(Math.abs(a.red - b.red), Math.abs(a.green - b.green), Math.abs(a.blue - b.blue));
}

async function expectProbeRedReadout(expected: number): Promise<void> {
  await expectPixelReadoutToEqual(launched.window, {
    panel: PANEL,
    imageX: PROBE.x,
    imageY: PROBE.y,
    dimensions: DIMENSIONS,
    expected,
  });
}

async function expectOneAllBandsHistoryEntry(): Promise<void> {
  expect(await historyEntryCount(launched.window)).toBe(1);
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: BRIGHTNESS_CONTRAST_LABEL,
    detailSubstrings: ["Brightness +20%", "contrast 1.20", "all bands"],
  });
}
