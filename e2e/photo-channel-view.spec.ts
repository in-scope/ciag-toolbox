import { expect, test } from "@playwright/test";

import { multiBandTiff, rgbPng } from "./fixtures/fixture-manifest";
import type { PixelDimensions } from "./support/page-objects";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  historyEntryCount,
  loadFixtureAsStack,
  panelCanvas,
  panelCell,
  selectPanel,
} from "./support/page-objects";
import { colorfulNonClearPixelFraction } from "./support/canvas-pixels";
import { selectActiveBandNumber } from "./support/band-navigator";
import { expectPanelHeaderToName } from "./support/panel-header-label";
import { readPixelValueAt } from "./support/pixel-readout";
import {
  expectChannelViewEnabled,
  toggleChannelView,
  channelViewToggle,
} from "./support/channel-view";

// CT-248: a colour photo flips between its normal composite view and a display-only
// channel view where the three bands scroll like any stack. rgb.png (2x2, documented
// per-pixel R/G/B) is the fixture. The grayscale oracle is colorfulNonClearPixelFraction
// (the CT-159 detector): a composite keeps channels apart (three of the four fixture
// pixels exceed the spread threshold, so the fraction sits near 0.75) while a
// single-channel render replicates one band into R==G==B, collapsing the COLORFUL
// distinct-colour population to ~0. The data oracle is the status-bar pixel readout at
// (0,0)=(200,100,50): the channel view scrolls it through 200 -> 100 -> 50 with the band
// identity labels #1 Red / #2 Green / #3 Blue, and after toggling back the readout is
// byte-identical to the baseline (display-only, no History entry).

const PANEL = 1;
const DIMENSIONS: PixelDimensions = { width: rgbPng.width, height: rgbPng.height };
const PROBE = { x: 0, y: 0 };
const PROBE_VALUES_PER_BAND = ["200", "100", "50"];
const PROBE_BAND_LABELS = ["#1 Red", "#2 Green", "#3 Blue"];
const COMPOSITE_MIN_COLORFUL_FRACTION = 0.4;
const GRAYSCALE_MAX_COLORFUL_FRACTION = 0.02;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("a color photo flips to scrollable channels and back with no data change", async () => {
  await test.step("open rgb.png as the composite photo", async () => {
    await loadFixtureAsStack(launched.window, rgbPng.fileName);
    await selectPanel(launched.window, PANEL);
  });
  await test.step("baseline: composite render, no band navigator, toggle offered", async () => {
    await expectChannelViewEnabled(launched.window, PANEL, false);
    await expectChannelViewToggleShowsVennGlyph();
    await expect(bandNavigator()).toHaveCount(0);
    await expectPanelHeaderToName(launched.window, PANEL, rgbPng.fileName);
    await expectColorfulFractionAbove(COMPOSITE_MIN_COLORFUL_FRACTION);
    await expectProbeReadout(1);
  });
  await test.step("toggle on: single-channel grayscale render with the band navigator", async () => {
    await toggleChannelView(launched.window, PANEL);
    await expectChannelViewEnabled(launched.window, PANEL, true);
    await expect(bandNavigator()).toBeVisible();
    await expect(bandNavigator()).toContainText("/ 3");
    await expectColorfulFractionBelow(GRAYSCALE_MAX_COLORFUL_FRACTION);
    await expectPanelHeaderToName(launched.window, PANEL, `${rgbPng.fileName} - #1 Red`);
  });
  await test.step("scroll the three channels: readout and header follow each band", async () => {
    for (const bandNumber of [1, 2, 3]) {
      await selectActiveBandNumber(launched.window, bandNumber);
      await expectPanelHeaderToName(
        launched.window,
        PANEL,
        `${rgbPng.fileName} - ${PROBE_BAND_LABELS[bandNumber - 1]}`,
      );
      await expectProbeReadout(bandNumber);
    }
  });
  await test.step("toggle off: composite restored, readout identical, no History", async () => {
    await toggleChannelView(launched.window, PANEL);
    await expectChannelViewEnabled(launched.window, PANEL, false);
    await expect(bandNavigator()).toHaveCount(0);
    await expectPanelHeaderToName(launched.window, PANEL, rgbPng.fileName);
    await expectColorfulFractionAbove(COMPOSITE_MIN_COLORFUL_FRACTION);
    await expectProbeReadout(1);
    expect(await historyEntryCount(launched.window)).toBe(0);
  });
});

test("a scientific multi-band stack never offers the channel-view toggle", async () => {
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
  await expect(bandNavigator()).toBeVisible();
  await expect(channelViewToggle(launched.window, PANEL)).toHaveCount(0);
});

function bandNavigator() {
  return panelCell(launched.window, PANEL).getByTestId("viewport-band-navigator");
}

// CT-295: the toggle carries the RgbCompositeIcon venn glyph (shared with the RGB
// Color Composite operation) - exactly three overlapping <circle> elements.
async function expectChannelViewToggleShowsVennGlyph(): Promise<void> {
  const circleCount = await channelViewToggle(launched.window, PANEL).locator("svg circle").count();
  expect(circleCount).toBe(3);
}

async function expectProbeReadout(bandNumber: number): Promise<void> {
  await expect
    .poll(async () => {
      const readout = await readPixelValueAt(
        launched.window,
        PANEL,
        PROBE.x,
        PROBE.y,
        DIMENSIONS,
      );
      return `${readout.bandLabel} = ${readout.value}`;
    })
    .toBe(`${PROBE_BAND_LABELS[bandNumber - 1]} = ${PROBE_VALUES_PER_BAND[bandNumber - 1]}`);
}

async function expectColorfulFractionAbove(minimum: number): Promise<void> {
  await expect
    .poll(() => colorfulNonClearPixelFraction(panelCanvas(launched.window, PANEL)))
    .toBeGreaterThan(minimum);
}

async function expectColorfulFractionBelow(maximum: number): Promise<void> {
  await expect
    .poll(() => colorfulNonClearPixelFraction(panelCanvas(launched.window, PANEL)))
    .toBeLessThan(maximum);
}
