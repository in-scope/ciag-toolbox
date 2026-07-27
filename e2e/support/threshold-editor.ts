import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { operationPanel } from "./operations";

// CT-200: page objects for the Threshold operation panel's embedded bounds
// editor. The histogram overlay exposes two draggable handles ("Lower bound
// handle" / "Upper bound handle") plus a numeric Input per bound ("Lower
// bound" / "Upper bound"). Handle drags use raw mouse events: pointer capture
// lands on the handle button and the captured moves bubble to the overlay,
// exactly like the tone-curve anchor drag.

export const THRESHOLD_OPERATION_LABEL = "Threshold";

export type ThresholdBoundSide = "Lower" | "Upper";

export function thresholdBoundHandle(page: Page, side: ThresholdBoundSide): Locator {
  return operationPanel(page, THRESHOLD_OPERATION_LABEL).getByRole("button", {
    name: `${side} bound handle`,
    exact: true,
  });
}

export function thresholdBoundField(page: Page, side: ThresholdBoundSide): Locator {
  return operationPanel(page, THRESHOLD_OPERATION_LABEL).getByLabel(`${side} bound`, {
    exact: true,
  });
}

export async function expectThresholdEditorReady(page: Page): Promise<void> {
  await expect(thresholdBoundHandle(page, "Lower")).toBeVisible();
  await expect(thresholdBoundHandle(page, "Upper")).toBeVisible();
}

// CT-201: the Auto button derives the Otsu cutoff(s) and sets the bounds.
export function thresholdAutoButton(page: Page): Locator {
  return operationPanel(page, THRESHOLD_OPERATION_LABEL).getByRole("button", {
    name: "Auto",
    exact: true,
  });
}

export async function clickThresholdOtsuAutoButton(page: Page): Promise<void> {
  await thresholdAutoButton(page).click();
}

export async function setThresholdBoundField(
  page: Page,
  side: ThresholdBoundSide,
  value: number,
): Promise<void> {
  const field = thresholdBoundField(page, side);
  await field.fill(String(value));
  await field.press("Enter");
  await expect(field).toHaveValue(String(value));
}

export async function readThresholdBoundFieldValue(
  page: Page,
  side: ThresholdBoundSide,
): Promise<string> {
  return thresholdBoundField(page, side).inputValue();
}

// Starts a drag on a bound handle and moves it to a horizontal fraction of the
// histogram overlay WITHOUT releasing the button, so a spec can assert the
// live preview mid-drag. Follow with releaseThresholdBoundDrag.
export async function dragThresholdBoundHandleToFraction(
  page: Page,
  side: ThresholdBoundSide,
  fraction: number,
): Promise<void> {
  const handle = thresholdBoundHandle(page, side);
  const overlayBox = await requireBoundingBox(handle.locator("xpath=.."), "histogram overlay");
  const handleBox = await requireBoundingBox(handle, `${side} bound handle`);
  const y = overlayBox.y + overlayBox.height / 2;
  await page.mouse.move(handleBox.x + handleBox.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(overlayBox.x + overlayBox.width * fraction, y, { steps: 8 });
}

export async function releaseThresholdBoundDrag(page: Page): Promise<void> {
  await page.mouse.up();
}

interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function requireBoundingBox(locator: Locator, description: string): Promise<BoundingBox> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Expected the ${description} to be visible for a bound drag`);
  return box;
}
