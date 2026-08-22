import { expect, test } from "@playwright/test";
import { join } from "node:path";
import sharp from "sharp";
import type { Page } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { colorfulNonClearPixelFraction } from "./support/canvas-pixels";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  createMaskLayer,
  createTemporaryExportDirectory,
  enableMaskEraser,
  exportSelectedMaskToPath,
  loadFixtureAsStack,
  openMasksOptions,
  paintMaskDotAtPagePoint,
  pagePointForImagePixelCenter,
  paintMaskStrokeBetweenPixels,
  panelCanvas,
  panelCanvasCenter,
  readPixelValueAt,
  readReadoutAtPagePoint,
  selectMaskBrushCategory,
  selectPanel,
  setMaskBrushSizeToOnePixel,
  wheelAtPagePoint,
} from "./support/page-objects";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-304: freehand mask painting on multiband-12bit.tif (4x4 uint16). The
// oracles, one per claim the story makes:
//   - the overlay is really on screen: colorfulNonClearPixelFraction of the
//     panel canvas, which reads ~0 for this dark 12-bit stack until a category
//     colour is painted over it;
//   - the DATA is untouched: the status-bar pixel readout at the painted pixel
//     still reports the value it reported before the stroke;
//   - the right pixels carry the right category: the CT-303 export flow writes
//     the mask out and sharp decodes it back sample-for-sample in this spec.
// The brush is set to 1 image pixel so a drag between two pixel CENTRES paints
// exactly those pixels. The zoom case cannot use the fit-view mapping at all,
// so it asks the READOUT which pixel sits under the cursor and then paints
// there, which is the "strokes respect zoom and pan" claim stated directly.

const PANEL = 1;
const IMAGE = { width: multiBandTiff.width, height: multiBandTiff.height };
const PAINTED_PIXEL = { x: 1, y: 1 };
const STROKE_END_PIXEL = { x: 2, y: 1 };
// Two of the 4x4 stack's sixteen pixels carry the tint, and this dark 12-bit
// stack contributes almost no non-clear pixels of its own, so the coloured
// share lands far above this floor - and a silently missing overlay reads 0.
const MINIMUM_TINTED_FRACTION = 0.05;
const WHEEL_STEP_DELTA = 240;

function buildExpectedMaskValues(painted: ReadonlyMap<number, number>): ReadonlyArray<number> {
  const values = new Array<number>(IMAGE.width * IMAGE.height).fill(0);
  for (const [index, value] of painted) values[index] = value;
  return values;
}

function pixelIndexOf(x: number, y: number): number {
  return y * IMAGE.width + x;
}

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("paints a stroke that tints the panel without changing the data underneath", async () => {
  const page = launched.window;
  const canvas = panelCanvas(page, PANEL);

  const valueBeforePainting = await readPaintedPixelValue(page);
  const colourBeforePainting = await colorfulNonClearPixelFraction(canvas);

  await openMasksOptions(page);
  await createMaskLayer(page);
  await setMaskBrushSizeToOnePixel(page);
  await paintMaskStrokeBetweenPixels(page, PANEL, PAINTED_PIXEL, STROKE_END_PIXEL, IMAGE);

  await runAsStoryboardStep(page, "Check the overlay tinted the panel", async () => {
    await expect
      .poll(() => colorfulNonClearPixelFraction(canvas))
      .toBeGreaterThan(Math.max(colourBeforePainting, MINIMUM_TINTED_FRACTION));
  });
  await runAsStoryboardStep(page, "Check the data under the stroke is unchanged", async () => {
    expect(await readPaintedPixelValue(page)).toBe(valueBeforePainting);
  });

  await expectExportedMaskValues(
    page,
    buildExpectedMaskValues(
      new Map([
        [pixelIndexOf(PAINTED_PIXEL.x, PAINTED_PIXEL.y), 1],
        [pixelIndexOf(STROKE_END_PIXEL.x, STROKE_END_PIXEL.y), 1],
      ]),
    ),
  );
});

test("paints the chosen category and erases it back to unlabeled", async () => {
  const page = launched.window;

  await openMasksOptions(page);
  await createMaskLayer(page);
  await setMaskBrushSizeToOnePixel(page);
  await selectMaskBrushCategory(page, 2);
  await paintMaskStrokeBetweenPixels(page, PANEL, PAINTED_PIXEL, STROKE_END_PIXEL, IMAGE);

  await enableMaskEraser(page);
  await paintMaskStrokeBetweenPixels(page, PANEL, STROKE_END_PIXEL, STROKE_END_PIXEL, IMAGE);

  await expectExportedMaskValues(
    page,
    buildExpectedMaskValues(new Map([[pixelIndexOf(PAINTED_PIXEL.x, PAINTED_PIXEL.y), 2]])),
  );
});

test("paints the pixel under the cursor after the view is zoomed in", async () => {
  const page = launched.window;

  await openMasksOptions(page);
  await createMaskLayer(page);
  await setMaskBrushSizeToOnePixel(page);

  const center = await panelCanvasCenter(page, PANEL);
  const pixelAtCentreBeforeZoom = await readReadoutAtPagePoint(page, center);
  // Zooming anchored on the stack's first pixel drags a DIFFERENT image pixel
  // under the canvas centre, so a brush that ignored the view transform would
  // paint the pre-zoom pixel and fail the export assertion.
  const zoomAnchor = await pagePointForImagePixelCentre(page, { x: 0, y: 0 });
  await wheelAtPagePoint(page, zoomAnchor, -WHEEL_STEP_DELTA, 3);
  // readReadoutAtPagePoint settles on the point one pixel right of the one it
  // is given, so that is the point the dot has to land on.
  const readout = await readReadoutAtPagePoint(page, center);
  expect([readout.imageX, readout.imageY]).not.toEqual([
    pixelAtCentreBeforeZoom.imageX,
    pixelAtCentreBeforeZoom.imageY,
  ]);
  await paintMaskDotAtPagePoint(page, { x: center.x + 1, y: center.y });

  await expectExportedMaskValues(
    page,
    buildExpectedMaskValues(new Map([[pixelIndexOf(readout.imageX, readout.imageY), 1]])),
  );
});

async function pagePointForImagePixelCentre(
  page: Page,
  pixel: { readonly x: number; readonly y: number },
): Promise<{ readonly x: number; readonly y: number }> {
  return pagePointForImagePixelCenter(page, PANEL, pixel, IMAGE);
}

async function readPaintedPixelValue(page: Page): Promise<string> {
  const readout = await readPixelValueAt(page, PANEL, PAINTED_PIXEL.x, PAINTED_PIXEL.y, IMAGE);
  return readout.value;
}

async function expectExportedMaskValues(
  page: Page,
  expectedValues: ReadonlyArray<number>,
): Promise<void> {
  const exportPath = join(await createTemporaryExportDirectory(), "painted-mask.png");
  await exportSelectedMaskToPath(page, exportPath);
  await runAsStoryboardStep(page, "Decode the exported mask in Node", async () => {
    // "b-w" keeps the single 8-bit channel whose samples ARE the category
    // indexes; sharp's default pipeline would expand it to three channels.
    const decoded = await sharp(exportPath)
      .toColourspace("b-w")
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(Array.from(decoded.data)).toEqual([...expectedValues]);
  });
}
