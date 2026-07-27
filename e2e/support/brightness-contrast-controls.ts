import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { operationPanel } from "./operations";

// CT-140: the Brightness & Contrast panel exposes two Radix sliders (Brightness as a
// percent of the data-type range, Contrast as a multiplier around the band mean) plus an
// "Apply to all bands" switch. Each slider's Root carries the schema label as aria-label;
// the focusable role="slider" thumb inside it holds aria-valuenow/aria-valuemax. Driving
// the thumb by arrow keys snaps to the schema step exactly, so there is no brittle pixel
// math and the applied value is deterministic.

export const BRIGHTNESS_CONTRAST_LABEL = "Brightness & Contrast";
export const BRIGHTNESS_SLIDER_LABEL = "Brightness";
export const CONTRAST_SLIDER_LABEL = "Contrast";

export function brightnessContrastSliderThumb(page: Page, sliderLabel: string): Locator {
  return operationPanel(page, BRIGHTNESS_CONTRAST_LABEL)
    .locator(`[aria-label="${sliderLabel}"]`)
    .getByRole("slider");
}

export async function setBrightnessContrastSlider(
  page: Page,
  sliderLabel: string,
  targetValue: number,
): Promise<void> {
  const thumb = brightnessContrastSliderThumb(page, sliderLabel);
  await thumb.focus();
  await stepSliderThumbTowardValue(thumb, targetValue);
  await expectSliderValueClose(thumb, targetValue);
}

export async function maximizeBrightnessContrastSlider(
  page: Page,
  sliderLabel: string,
): Promise<void> {
  const thumb = brightnessContrastSliderThumb(page, sliderLabel);
  await thumb.focus();
  await thumb.press("End");
  const maximum = await thumb.getAttribute("aria-valuemax");
  await expect(thumb).toHaveAttribute("aria-valuenow", maximum ?? "");
}

// CT-257: the Contrast slider is log-symmetric. Its Radix track runs over
// POSITIONS 0..1 (aria-valuenow is the position, not the ratio) and the app
// commits round-to-2-decimals(20^(2p - 1)). Contrast is therefore driven by
// stepping the thumb and converting each observed position through that same
// mapping. Reachable ratios are quantized: from the default 1 each arrow step
// multiplies by 20^0.01 (~3%), e.g. 1 -> 1.03 -> 1.06 -> ... -> 1.20 -> ... ->
// 1.99; End lands on exactly 20 and Home on exactly 0.05.

export const CONTRAST_SLIDER_MAXIMUM_VALUE = 20;

export function contrastRatioAtSliderPosition(position: number): number {
  const ratio = Math.pow(CONTRAST_SLIDER_MAXIMUM_VALUE, 2 * position - 1);
  return Math.round(ratio * 100) / 100;
}

export async function setLogSymmetricContrastSlider(page: Page, targetRatio: number): Promise<void> {
  const thumb = brightnessContrastSliderThumb(page, CONTRAST_SLIDER_LABEL);
  await thumb.focus();
  for (let attempt = 0; attempt < MAXIMUM_SLIDER_STEPS; attempt += 1) {
    const current = contrastRatioAtSliderPosition(await readSliderValue(thumb));
    if (Math.abs(current - targetRatio) < SLIDER_VALUE_EPSILON) return;
    await thumb.press(current < targetRatio ? "ArrowRight" : "ArrowLeft");
  }
  throw new Error(`Contrast slider did not reach ${targetRatio} within ${MAXIMUM_SLIDER_STEPS} steps`);
}

export function contrastSliderDisplayedValue(page: Page): Locator {
  return operationPanel(page, BRIGHTNESS_CONTRAST_LABEL).locator('label:text-is("Contrast") + span');
}

const MAXIMUM_SLIDER_STEPS = 240;

async function stepSliderThumbTowardValue(thumb: Locator, targetValue: number): Promise<void> {
  for (let attempt = 0; attempt < MAXIMUM_SLIDER_STEPS; attempt += 1) {
    const current = await readSliderValue(thumb);
    if (Math.abs(current - targetValue) < SLIDER_VALUE_EPSILON) return;
    await thumb.press(current < targetValue ? "ArrowRight" : "ArrowLeft");
  }
  throw new Error(`Slider did not reach ${targetValue} within ${MAXIMUM_SLIDER_STEPS} steps`);
}

const SLIDER_VALUE_EPSILON = 1e-6;

async function readSliderValue(thumb: Locator): Promise<number> {
  return Number(await thumb.getAttribute("aria-valuenow"));
}

async function expectSliderValueClose(thumb: Locator, targetValue: number): Promise<void> {
  const finalValue = await readSliderValue(thumb);
  expect(Math.abs(finalValue - targetValue)).toBeLessThan(SLIDER_VALUE_EPSILON);
}

export function applyToAllBandsSwitch(page: Page): Locator {
  return operationPanel(page, BRIGHTNESS_CONTRAST_LABEL).getByRole("switch", {
    name: "Apply to all bands",
  });
}

export async function setApplyToAllBands(page: Page, shouldApplyToAllBands: boolean): Promise<void> {
  const toggle = applyToAllBandsSwitch(page);
  const isChecked = (await toggle.getAttribute("aria-checked")) === "true";
  if (isChecked !== shouldApplyToAllBands) await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", String(shouldApplyToAllBands));
}
