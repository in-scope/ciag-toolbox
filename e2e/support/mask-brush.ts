import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import type { CanvasPoint, PixelDimensions } from "./image-pixel-canvas-mapping";
import { masksOptionsPanel } from "./masks-panel";
import { runAsStoryboardStep } from "./storyboard-step";
import {
  dragMouseFromTo,
  pagePointForImagePixelCenter,
  type ImagePixel,
} from "./viewport-navigation";

// CT-304: the Masks aside's brush controls, and freehand painting on the panel
// canvas. The brush size is in IMAGE pixels, so a stroke between two pixel
// centres at size 1 paints exactly the pixels the drag passed over - which is
// what makes an exported-mask assertion exact.

export function maskBrushCategoryOption(page: Page, position: number): Locator {
  return masksOptionsPanel(page)
    .locator('[aria-label="Brush category"]')
    .getByRole("radio")
    .nth(position - 1);
}

export function maskEraserToggle(page: Page): Locator {
  return masksOptionsPanel(page).getByRole("button", { name: "Eraser", exact: true });
}

// Radix puts the aria-label on the slider ROOT and role="slider" on the thumb.
export function maskBrushSizeSlider(page: Page): Locator {
  return masksOptionsPanel(page).locator('[aria-label="Brush size"]').getByRole("slider");
}

export async function selectMaskBrushCategory(page: Page, position: number): Promise<void> {
  await runAsStoryboardStep(page, `Arm the brush with category ${position}`, async () => {
    await maskBrushCategoryOption(page, position).click();
    await expect(maskBrushCategoryOption(page, position)).toHaveAttribute("aria-checked", "true");
  });
}

export async function enableMaskEraser(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Switch the brush to the eraser", async () => {
    await maskEraserToggle(page).click();
    await expect(maskEraserToggle(page)).toHaveAttribute("aria-pressed", "true");
  });
}

// Home drives the Radix slider straight to its minimum, one image pixel.
export async function setMaskBrushSizeToOnePixel(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Set the brush size to 1 image pixel", async () => {
    const thumb = maskBrushSizeSlider(page);
    await thumb.focus();
    await thumb.press("Home");
    await expect(thumb).toHaveAttribute("aria-valuenow", "1");
  });
}

export async function paintMaskStrokeBetweenPixels(
  page: Page,
  panelNumber: number,
  startPixel: ImagePixel,
  endPixel: ImagePixel,
  imageDimensions: PixelDimensions,
): Promise<void> {
  const description = `Paint from (${startPixel.x}, ${startPixel.y}) to (${endPixel.x}, ${endPixel.y})`;
  await runAsStoryboardStep(page, description, async () => {
    const from = await pagePointForImagePixelCenter(page, panelNumber, startPixel, imageDimensions);
    const to = await pagePointForImagePixelCenter(page, panelNumber, endPixel, imageDimensions);
    await dragMouseFromTo(page, from, to);
  });
}

// A stroke with no travel: pointer down, no movement, pointer up. Used where the
// target is a PAGE point rather than an image pixel (a zoomed or panned view,
// where the fit-view mapping no longer applies).
export async function paintMaskDotAtPagePoint(page: Page, point: CanvasPoint): Promise<void> {
  const description = `Paint one dot at page point (${Math.round(point.x)}, ${Math.round(point.y)})`;
  await runAsStoryboardStep(page, description, async () => {
    await dragMouseFromTo(page, point, point);
  });
}
