import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import type { PixelDimensions } from "./image-pixel-canvas-mapping";
import { operationPanel } from "./operations";
import { dragMouseFromTo, pagePointForImagePixelCenter, type ImagePixel } from "./viewport-navigation";

// The shared per-operation region-request flow (CT-095 / CT-130). Operations that need an
// area (Crop to Region, Tone Curve region scope, Spectralon) DO NOT consume the inspection
// ROI; their tool-options panel shows an "Operation region" picker that prompts for a fresh
// region. Until a region is selected the placeholder shows and Apply stays disabled; clicking
// "Select region" then dragging on the panel canvas commits the operation's own region.

const OPERATION_REGION_PLACEHOLDER_TEXT = "Select a region on the image for this operation.";

export function operationRegionPlaceholder(page: Page, operationLabel: string): Locator {
  return operationPanel(page, operationLabel).getByText(OPERATION_REGION_PLACEHOLDER_TEXT);
}

export function selectOperationRegionButton(page: Page, operationLabel: string): Locator {
  return operationPanel(page, operationLabel).getByRole("button", { name: "Select region" });
}

function operationApplyButton(page: Page, operationLabel: string): Locator {
  return operationPanel(page, operationLabel).getByRole("button", { name: "Apply", exact: true });
}

export async function expectOperationAwaitsItsOwnRegion(
  page: Page,
  operationLabel: string,
): Promise<void> {
  await expect(operationRegionPlaceholder(page, operationLabel)).toBeVisible();
  await expect(operationApplyButton(page, operationLabel)).toBeDisabled();
}

export interface OperationRegionDragRequest {
  readonly panelNumber: number;
  readonly operationLabel: string;
  readonly startPixel: ImagePixel;
  readonly endPixel: ImagePixel;
  readonly imageDimensions: PixelDimensions;
}

export async function selectOperationRegionByDrag(
  page: Page,
  request: OperationRegionDragRequest,
): Promise<void> {
  await selectOperationRegionButton(page, request.operationLabel).click();
  await dragOperationRegionAcrossPanel(page, request);
  await expect(operationApplyButton(page, request.operationLabel)).toBeEnabled();
}

async function dragOperationRegionAcrossPanel(
  page: Page,
  request: OperationRegionDragRequest,
): Promise<void> {
  const from = await pagePointForImagePixelCenter(
    page,
    request.panelNumber,
    request.startPixel,
    request.imageDimensions,
  );
  const to = await pagePointForImagePixelCenter(
    page,
    request.panelNumber,
    request.endPixel,
    request.imageDimensions,
  );
  await dragMouseFromTo(page, from, to);
}
