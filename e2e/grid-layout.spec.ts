import { test, expect } from "@playwright/test";

import {
  flatFieldReferenceTiff,
  lowContrastGrayPng,
  multiBandTiff,
  rgbPng,
} from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  closedPanelsToast,
  countPanels,
  expectPanelHoldsFile,
  expectPanelIsEmpty,
  loadFixtureAsStack,
  panelCanvas,
  readOfferedGridLayoutLabels,
  selectGridLayout,
} from "./support/page-objects";

// Manual test script section 8 (CT-008): the Grid Layout dropdown and the
// grow/shrink behaviour. The dropdown intentionally offers 1x3 and 3x1 in
// addition to the six layouts the (stale) manual section 8.1 lists; the unit
// test grid-layout.test.ts ("includes the new 1x3 and 3x1 layouts") documents
// them as supported, so the real supported set is the eight asserted here.
const SUPPORTED_GRID_LAYOUTS = [
  { label: "1x1", panelCount: 1 },
  { label: "1x2", panelCount: 2 },
  { label: "2x1", panelCount: 2 },
  { label: "1x3", panelCount: 3 },
  { label: "3x1", panelCount: 3 },
  { label: "2x2", panelCount: 4 },
  { label: "2x3", panelCount: 6 },
  { label: "3x2", panelCount: 6 },
] as const;

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchToolboxApp();
});

test.afterAll(async () => {
  await closeToolboxApp(launched);
});

test("the Grid Layout dropdown offers exactly the supported layouts", async () => {
  const offered = await readOfferedGridLayoutLabels(launched.window);
  expect(offered).toEqual(SUPPORTED_GRID_LAYOUTS.map((layout) => layout.label));
});

test("selecting a layout renders that many numbered panels", async () => {
  for (const layout of SUPPORTED_GRID_LAYOUTS) {
    await selectGridLayout(launched.window, layout.label);
    await assertNumberedPanelsRendered(launched, layout.panelCount);
  }
});

test("shrinking closes populated panels with a toast and regrowing returns them empty", async () => {
  const app = await launchToolboxApp();
  try {
    await loadFourDistinctStacksIntoTwoByTwoGrid(app);
    await shrinkToOneByTwoAndAssertClosedPanelsToast(app);
    await regrowToTwoByTwoAndAssertRetainedPlusEmpty(app);
  } finally {
    await closeToolboxApp(app);
  }
});

async function assertNumberedPanelsRendered(app: LaunchedApp, expectedCount: number): Promise<void> {
  expect(await countPanels(app.window)).toBe(expectedCount);
  for (let panelNumber = 1; panelNumber <= expectedCount; panelNumber++) {
    await expect(panelCanvas(app.window, panelNumber)).toBeVisible();
  }
  await expect(panelCanvas(app.window, expectedCount + 1)).toHaveCount(0);
}

async function loadFourDistinctStacksIntoTwoByTwoGrid(app: LaunchedApp): Promise<void> {
  await selectGridLayout(app.window, "2x2");
  await loadFixtureAsStack(app.window, lowContrastGrayPng.fileName);
  await loadFixtureAsStack(app.window, rgbPng.fileName);
  await loadFixtureAsStack(app.window, multiBandTiff.fileName);
  await loadFixtureAsStack(app.window, flatFieldReferenceTiff.fileName);
}

async function shrinkToOneByTwoAndAssertClosedPanelsToast(app: LaunchedApp): Promise<void> {
  await selectGridLayout(app.window, "1x2");
  const toast = closedPanelsToast(app.window);
  await expect(toast).toContainText("Closed panels:");
  await expect(toast).toContainText(`3 (${multiBandTiff.fileName})`);
  await expect(toast).toContainText(`4 (${flatFieldReferenceTiff.fileName})`);
  await expectPanelHoldsFile(app.window, 1, lowContrastGrayPng.fileName);
  await expectPanelHoldsFile(app.window, 2, rgbPng.fileName);
}

async function regrowToTwoByTwoAndAssertRetainedPlusEmpty(app: LaunchedApp): Promise<void> {
  await selectGridLayout(app.window, "2x2");
  await expectPanelHoldsFile(app.window, 1, lowContrastGrayPng.fileName);
  await expectPanelHoldsFile(app.window, 2, rgbPng.fileName);
  await expectPanelIsEmpty(app.window, 3);
  await expectPanelIsEmpty(app.window, 4);
}
