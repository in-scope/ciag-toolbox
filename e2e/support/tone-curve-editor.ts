import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import type { CanvasPoint } from "./image-pixel-canvas-mapping";
import { operationPanel } from "./operations";
import { dragMouseFromTo } from "./viewport-navigation";

// CT-139 / manual sections 6, 24, 25 (CT-080, CT-098, CT-099): the tone-curve editor.
// The editor is embedded OVER the band histogram INSIDE the Tone Curve tool-options panel
// (aside[aria-label="Tone Curve options"]). The handles are <button>s: endpoints
// "Curve endpoint", interior "Curve anchor (right-click to remove)". The handle position is
// the curve's control point: inline style left% = input fraction across the X axis (input
// min..max), top% = 1 - output fraction across the Y axis (output min..max).
//
// IMPORTANT (CT-139): for an INTEGER band the histogram X range is the data-type container
// range (uint16 -> 0..65535), so the DEFAULT two-endpoint curve is the IDENTITY line, not a
// data-bracketing stretch. A real black/white stretch is produced by dragging the endpoints;
// because band 0's data (100..250) occupies <0.4% of the input axis, exact per-pixel oracles
// read the resulting anchors back from the DOM rather than relying on sub-pixel drag accuracy.

export const TONE_CURVE_LABEL = "Tone Curve";

const ENDPOINT_HANDLE_NAME = "Curve endpoint";
const INTERIOR_HANDLE_NAME = "Curve anchor (right-click to remove)";
const HISTOGRAM_CANVAS_NAME = "Active band intensity histogram";
const ANY_HANDLE_SELECTOR =
  `button[aria-label="${ENDPOINT_HANDLE_NAME}"], button[aria-label^="Curve anchor"]`;
const SELECTED_HANDLE_SELECTOR =
  `button[aria-label="${ENDPOINT_HANDLE_NAME}"][data-selected="true"], ` +
  `button[aria-label^="Curve anchor"][data-selected="true"]`;

export interface ToneCurveValueRanges {
  readonly inputMin: number;
  readonly inputMax: number;
  readonly outputMin: number;
  readonly outputMax: number;
}

export interface ToneCurveAnchorPoint {
  readonly input: number;
  readonly output: number;
}

export function toneCurveEditorHistogramCanvas(page: Page): Locator {
  return operationPanel(page, TONE_CURVE_LABEL).getByRole("img", { name: HISTOGRAM_CANVAS_NAME });
}

export function toneCurveEndpointHandles(page: Page): Locator {
  return operationPanel(page, TONE_CURVE_LABEL).getByRole("button", { name: ENDPOINT_HANDLE_NAME });
}

export function toneCurveInteriorHandles(page: Page): Locator {
  return operationPanel(page, TONE_CURVE_LABEL).getByRole("button", { name: INTERIOR_HANDLE_NAME });
}

export function toneCurveAllHandles(page: Page): Locator {
  return operationPanel(page, TONE_CURVE_LABEL).locator(ANY_HANDLE_SELECTOR);
}

// CT-164: exactly one anchor handle is selected at a time, exposed via the stable
// data-selected="true" attribute (used by the CT-165 numeric fields and these specs).
export function selectedToneCurveAnchorHandles(page: Page): Locator {
  return operationPanel(page, TONE_CURVE_LABEL).locator(SELECTED_HANDLE_SELECTOR);
}

export async function expectExactlyOneToneCurveAnchorSelected(page: Page): Promise<void> {
  await expect(selectedToneCurveAnchorHandles(page)).toHaveCount(1);
}

export async function expectToneCurveHandleIsSelected(handle: Locator): Promise<void> {
  await expect(handle).toHaveAttribute("data-selected", "true");
}

export async function clickToneCurveAnchorHandle(handle: Locator): Promise<void> {
  await handle.click();
}

// CT-165: the selected anchor's Input/Output numeric fields with +/- steppers. Each field
// is an <input aria-label="Input"|"Output"> flanked by "Decrease <label>"/"Increase <label>"
// stepper buttons inside the Tone Curve tool-options panel.
export type ToneCurveAnchorFieldLabel = "Input" | "Output";

export function toneCurveAnchorField(page: Page, label: ToneCurveAnchorFieldLabel): Locator {
  return operationPanel(page, TONE_CURVE_LABEL).getByLabel(label, { exact: true });
}

export function readToneCurveAnchorFieldValue(
  page: Page,
  label: ToneCurveAnchorFieldLabel,
): Promise<string> {
  return toneCurveAnchorField(page, label).inputValue();
}

export async function setToneCurveAnchorField(
  page: Page,
  label: ToneCurveAnchorFieldLabel,
  value: number,
): Promise<void> {
  const field = toneCurveAnchorField(page, label);
  await field.fill(String(value));
  await field.press("Enter");
}

export async function stepToneCurveAnchorField(
  page: Page,
  label: ToneCurveAnchorFieldLabel,
  direction: "increase" | "decrease",
): Promise<void> {
  const verb = direction === "increase" ? "Increase" : "Decrease";
  await operationPanel(page, TONE_CURVE_LABEL).getByRole("button", { name: `${verb} ${label}` }).click();
}

export async function expectToneCurveOpensWithTwoEndpoints(page: Page): Promise<void> {
  await expect(toneCurveEndpointHandles(page)).toHaveCount(2);
  await expect(toneCurveInteriorHandles(page)).toHaveCount(0);
}

export async function addToneCurveAnchorAtFraction(
  page: Page,
  fromLeft: number,
  fromTop: number,
): Promise<void> {
  const before = await toneCurveInteriorHandles(page).count();
  const point = await toneCurveEditorPoint(page, fromLeft, fromTop);
  await page.mouse.click(point.x, point.y);
  await expect(toneCurveInteriorHandles(page)).toHaveCount(before + 1);
}

// Drags an endpoint to a point that may sit OUTSIDE the editor: the editor clamps the
// pointer fraction to [0,1], so dragging beyond an edge lands the anchor on that exact
// edge value (e.g. above-left -> exactly inputMin/outputMax) with no sub-pixel error.
export async function dragToneCurveEndpointTo(
  page: Page,
  which: "left" | "right",
  fromLeft: number,
  fromTop: number,
): Promise<void> {
  const handle = which === "left" ? toneCurveEndpointHandles(page).first() : toneCurveEndpointHandles(page).last();
  const from = await handleCenterPoint(handle);
  const to = await toneCurveEditorPoint(page, fromLeft, fromTop);
  await dragMouseFromTo(page, from, to);
}

export async function readToneCurveAnchors(
  page: Page,
  ranges: ToneCurveValueRanges,
): Promise<ToneCurveAnchorPoint[]> {
  const handles = toneCurveAllHandles(page);
  const count = await handles.count();
  const anchors: ToneCurveAnchorPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    anchors.push(await readAnchorPointFromHandle(handles.nth(index), ranges));
  }
  return anchors;
}

async function readAnchorPointFromHandle(
  handle: Locator,
  ranges: ToneCurveValueRanges,
): Promise<ToneCurveAnchorPoint> {
  const percents = await handle.evaluate((el) => ({ left: el.style.left, top: el.style.top }));
  const xFraction = Number.parseFloat(percents.left) / 100;
  const yFraction = Number.parseFloat(percents.top) / 100;
  return {
    input: ranges.inputMin + xFraction * (ranges.inputMax - ranges.inputMin),
    output: ranges.outputMin + (1 - yFraction) * (ranges.outputMax - ranges.outputMin),
  };
}

async function handleCenterPoint(handle: Locator): Promise<CanvasPoint> {
  const box = await handle.boundingBox();
  if (!box) throw new Error("Tone Curve anchor handle has no bounding box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function toneCurveEditorPoint(page: Page, fromLeft: number, fromTop: number): Promise<CanvasPoint> {
  const box = await toneCurveEditorHistogramCanvas(page).boundingBox();
  if (!box) throw new Error("Tone Curve histogram canvas has no bounding box");
  return { x: box.x + box.width * fromLeft, y: box.y + box.height * fromTop };
}
