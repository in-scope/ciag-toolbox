import { test, expect } from "@playwright/test";

import { rgbPng } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  activateRegionTool,
  clickPanelToSelect,
  drawInspectionRoiBetweenPixels,
  duplicatePanelViaContextMenu,
  ensureRegionToolInactive,
  expectLinkPanZoomMenuItemIsDisabledWithHint,
  expectOnlyPanelsSelected,
  expectPanelIsLinked,
  linkPanZoomMenuItem,
  loadFixtureAsStack,
  openPanelContextMenuAtCorner,
  panelCanvasCenter,
  readCommittedRoiOverlayRect,
  resetViewWithDoubleClick,
  wheelAtPagePoint,
} from "./support/page-objects";

// CT-265: multi-select for linking works without a secret recipe. Right-clicking
// (or Ctrl-clicking on macOS, which the OS reports as a context-menu click) an
// UNSELECTED panel selects it before the menu opens, so the menu always applies
// to the panel under the cursor; with only one panel selected the Link entry is
// disabled with a hint naming the multi-select gesture; Ctrl-click multi-select
// then linking works end to end. Fixture: two copies of rgb.png (duplicate);
// oracle: aria-selected selection state per panel plus the linked-zoom ROI
// overlay assertion from linked-pan-zoom.spec.ts.

const FIRST_PANEL = 1;
const SECOND_PANEL = 2;
const IMAGE_2X2 = { width: rgbPng.width, height: rgbPng.height };
const ROI_START = { x: 0, y: 0 };
const ROI_END = { x: 1, y: 1 };
const WHEEL_STEP_DELTA = 1000;

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, rgbPng.fileName);
  await duplicatePanelViaContextMenu(launched.window, FIRST_PANEL);
});

test.afterAll(async () => {
  await closeToolboxApp(launched);
});

test("right-clicking an unselected panel selects it before the context menu opens", async () => {
  const page = launched.window;
  await clickPanelToSelect(page, FIRST_PANEL);
  await expectOnlyPanelsSelected(page, [FIRST_PANEL]);

  await openPanelContextMenuAtCorner(page, SECOND_PANEL);

  await expectOnlyPanelsSelected(page, [SECOND_PANEL]);
  await page.keyboard.press("Escape");
});

test("with one panel selected the Link entry is disabled with the multi-select hint", async () => {
  const page = launched.window;
  await clickPanelToSelect(page, FIRST_PANEL);
  await openPanelContextMenuAtCorner(page, FIRST_PANEL);

  await expectLinkPanZoomMenuItemIsDisabledWithHint(page);
  await page.keyboard.press("Escape");
});

test("Ctrl-clicked panels link from the context menu and zoom in sync", async () => {
  const page = launched.window;
  await clickPanelToSelect(page, FIRST_PANEL);
  await clickPanelToSelect(page, SECOND_PANEL, { ctrlOrMeta: true });
  await expectOnlyPanelsSelected(page, [FIRST_PANEL, SECOND_PANEL]);

  await openPanelContextMenuAtCorner(page, SECOND_PANEL);
  await expectOnlyPanelsSelected(page, [FIRST_PANEL, SECOND_PANEL]);
  await linkPanZoomMenuItem(page).click();

  await expectPanelIsLinked(page, FIRST_PANEL);
  await expectPanelIsLinked(page, SECOND_PANEL);
  await expectLinkedPanelsZoomTogether(page);
});

async function expectLinkedPanelsZoomTogether(page: LaunchedApp["window"]): Promise<void> {
  await ensureRegionToolInactive(page);
  await resetViewWithDoubleClick(page, await panelCanvasCenter(page, FIRST_PANEL));
  await activateRegionTool(page);
  await drawInspectionRoiBetweenPixels(page, FIRST_PANEL, ROI_START, ROI_END, IMAGE_2X2);
  await drawInspectionRoiBetweenPixels(page, SECOND_PANEL, ROI_START, ROI_END, IMAGE_2X2);
  const fitWidthA = (await readCommittedRoiOverlayRect(page, FIRST_PANEL)).width;
  const fitWidthB = (await readCommittedRoiOverlayRect(page, SECOND_PANEL)).width;
  await wheelAtPagePoint(page, await panelCanvasCenter(page, FIRST_PANEL), -WHEEL_STEP_DELTA, 2);
  const zoomedWidthA = (await readCommittedRoiOverlayRect(page, FIRST_PANEL)).width;
  const zoomedWidthB = (await readCommittedRoiOverlayRect(page, SECOND_PANEL)).width;
  expect(zoomedWidthA).toBeGreaterThan(fitWidthA * 1.5);
  expect(zoomedWidthB / fitWidthB).toBeCloseTo(zoomedWidthA / fitWidthA, 1);
}
