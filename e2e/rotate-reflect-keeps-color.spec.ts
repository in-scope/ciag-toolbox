import { test, expect } from "@playwright/test";

import { fixturePath, rgbPng } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyGeometricTransformInPlace,
  applyQuickGeometricTransform,
  colorfulNonClearPixelFraction,
  loadImageFromAbsolutePath,
  panelCanvas,
} from "./support/page-objects";

// CT-159: rotating or reflecting a true-colour image (a JPG/PNG, promoted to a 3-band R/G/B
// raster on the first operation) must keep showing colour. Before this fix the raster render
// path always treated a raster as one grayscale band, so a colour photo went grey the instant
// it was rotated. The committed rgb.png has vivid pure-red and pure-green pixels, so a healthy
// fraction of the rendered canvas has channels far enough apart to prove the composite is in
// colour; a grayscale render (R==G==B) would drive that fraction to ~0.
//
// FIXTURE: rgb.png is 2x2 (square), so a 90 rotation does not change the reported dimensions;
// the point under test is the rendered COLOUR, not the geometry (geometry is covered by
// rotate-reflect-operation.spec.ts on a non-square multi-band stack).

const PANEL = 1;
const COLORFUL_FRACTION_FLOOR = 0.3;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("a rotated colour image keeps its colours instead of turning grayscale", async () => {
  await loadColorImageIntoPanelOne();
  await expectPanelOneRendersInColor();

  await applyGeometricTransformInPlace(launched.app, launched.window, "rotate-90-cw");
  await expectPanelOneRendersInColor();
});

test("a reflected colour image keeps its colours instead of turning grayscale", async () => {
  await loadColorImageIntoPanelOne();
  await expectPanelOneRendersInColor();

  await applyQuickGeometricTransform(launched.window, "flip-horizontal");
  await expectPanelOneRendersInColor();
});

test("a rotated colour image is presented as one colour image, with no band navigator", async () => {
  await loadColorImageIntoPanelOne();
  await applyGeometricTransformInPlace(launched.app, launched.window, "rotate-90-cw");

  await expectPanelOneRendersInColor();
  await expect(bandNavigatorInput()).toHaveCount(0);
});

test("toast notifications appear at the bottom-left so they never cover the toolbar", async () => {
  await loadColorImageIntoPanelOne();
  await expect(toasterRegion()).toHaveAttribute("data-x-position", "left");
});

function bandNavigatorInput() {
  return launched.window.getByRole("textbox", { name: "Go to band number" });
}

function toasterRegion() {
  return launched.window.locator("[data-sonner-toaster]");
}

async function loadColorImageIntoPanelOne(): Promise<void> {
  await loadImageFromAbsolutePath(launched.window, fixturePath(rgbPng.fileName));
}

async function expectPanelOneRendersInColor(): Promise<void> {
  await expect
    .poll(async () => colorfulNonClearPixelFraction(panelCanvas(launched.window, PANEL)))
    .toBeGreaterThan(COLORFUL_FRACTION_FLOOR);
}
