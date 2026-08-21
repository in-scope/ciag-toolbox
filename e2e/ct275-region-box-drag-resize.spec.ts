import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { rgbPng } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  activateRegionTool,
  drawInspectionRoiBetweenPixels,
  expectExactlyOneCommittedRoi,
  loadFixtureAsStack,
  pagePointForImagePixelCenter,
  panelCanvas,
  readCommittedRoiOverlayRect,
  readRegionStats,
  selectPanel,
} from "./support/page-objects";

// CT-275: the committed region box drags and resizes instead of demanding a
// redraw. Fixture rgb.png (2x2); oracle: the Region section's Corners/Size rows
// (exact pixel coordinates) plus the single-box overlay markers. The body drag
// moves the box by EXACTLY the dragged offset (one image pixel) and the Region
// coordinates track LIVE before release; a corner dragged far past the image
// edge CLAMPS to the boundary rather than clearing the selection. Cursor
// feedback (move inside, diagonal resize on corners) is read from the canvas's
// inline style, which the edit attachment owns.

const PANEL = 1;
const IMAGE_2X2 = { width: rgbPng.width, height: rgbPng.height };
const LEFT_COLUMN_START = { x: 0, y: 0 };
const LEFT_COLUMN_END = { x: 0, y: 1 };
const CORNER_GRAB_INSET_PX = 2;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, rgbPng.fileName);
  await selectPanel(launched.window, PANEL);
  await activateRegionTool(launched.window);
  await drawInspectionRoiBetweenPixels(
    launched.window,
    PANEL,
    LEFT_COLUMN_START,
    LEFT_COLUMN_END,
    IMAGE_2X2,
  );
  await expectRegionStats("(0, 0) - (0, 1)", "1 x 2 px");
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("dragging the box body moves it by exactly the dragged offset, live", async () => {
  const page = launched.window;
  const grabPoint = await pagePointForImagePixelCenter(page, PANEL, { x: 0, y: 0 }, IMAGE_2X2);
  const rightNeighborCenter = await pagePointForImagePixelCenter(
    page,
    PANEL,
    { x: 1, y: 0 },
    IMAGE_2X2,
  );
  const oneImagePixelXPx = rightNeighborCenter.x - grabPoint.x;

  await test.step("hovering the box body shows the move cursor", async () => {
    await page.mouse.move(grabPoint.x, grabPoint.y);
    await expect.poll(() => readPanelCanvasCursor(page)).toBe("move");
  });

  await test.step("mid-drag, the Region coordinates already show the moved box", async () => {
    await page.mouse.down();
    await page.mouse.move(grabPoint.x + oneImagePixelXPx, grabPoint.y, { steps: 6 });
    await expect.poll(async () => (await readRegionStats(page)).corners).toBe("(1, 0) - (1, 1)");
  });

  await test.step("releasing commits the moved box, exactly one box remains", async () => {
    await page.mouse.up();
    await expectRegionStats("(1, 0) - (1, 1)", "1 x 2 px");
    await expectExactlyOneCommittedRoi(page, PANEL);
  });
});

test("dragging a corner past the image edge clamps to the boundary instead of clearing", async () => {
  const page = launched.window;
  const cornerPoint = await bottomRightHandlePagePoint(page);

  await test.step("hovering the bottom-right handle shows the diagonal resize cursor", async () => {
    await page.mouse.move(cornerPoint.x, cornerPoint.y);
    await expect.poll(() => readPanelCanvasCursor(page)).toBe("nwse-resize");
  });

  await test.step("drag the corner far past the image's right and bottom edges", async () => {
    const beyondImageEdge = await canvasBottomRightInsidePagePoint(page);
    await page.mouse.down();
    await page.mouse.move(beyondImageEdge.x, beyondImageEdge.y, { steps: 6 });
    await page.mouse.up();
  });

  await test.step("the box clamps to the image boundary and is not cleared", async () => {
    await expectRegionStats("(0, 0) - (1, 1)", "2 x 2 px");
    await expectExactlyOneCommittedRoi(page, PANEL);
  });
});

async function expectRegionStats(corners: string, size: string): Promise<void> {
  await expect.poll(() => readRegionStats(launched.window)).toEqual({ corners, size });
}

function readPanelCanvasCursor(page: Page): Promise<string> {
  return panelCanvas(page, PANEL).evaluate((canvas) => canvas.style.cursor);
}

// The bottom-right corner handle of the committed box, nudged a couple of pixels
// inward so the grab point stays on the canvas (the fitted image's bottom edge
// can coincide with the canvas edge); the nudge is well inside the handle's hit
// radius.
async function bottomRightHandlePagePoint(page: Page): Promise<{ x: number; y: number }> {
  const canvasBox = await readPanelCanvasBoundingBox(page);
  const overlayRect = await readCommittedRoiOverlayRect(page, PANEL);
  return {
    x: canvasBox.x + overlayRect.x + overlayRect.width - CORNER_GRAB_INSET_PX,
    y: canvasBox.y + overlayRect.y + overlayRect.height - CORNER_GRAB_INSET_PX,
  };
}

// A point at the canvas's own bottom-right corner: past the fitted image's
// right edge (the square image is letterboxed inside a wider canvas) and at
// its bottom edge, so a corner dragged there must clamp to the boundary.
async function canvasBottomRightInsidePagePoint(page: Page): Promise<{ x: number; y: number }> {
  const canvasBox = await readPanelCanvasBoundingBox(page);
  return {
    x: canvasBox.x + canvasBox.width - CORNER_GRAB_INSET_PX,
    y: canvasBox.y + canvasBox.height - CORNER_GRAB_INSET_PX,
  };
}

async function readPanelCanvasBoundingBox(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await panelCanvas(page, PANEL).boundingBox();
  if (!box) throw new Error(`Panel ${PANEL} canvas has no bounding box`);
  return box;
}
