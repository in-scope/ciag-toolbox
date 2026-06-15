import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// The viewport band navigator (viewport-band-navigator.tsx) overlays each multi-band
// panel with a 1-based "Go to band number" input that commits a band selection
// immediately on Enter (bypassing the slider's debounce), updating the Metadata panel's
// "Original band" and "Wavelength" rows. With a single loaded panel there is exactly one
// navigator, so this page-level locator is unambiguous; scope it to a panel cell if a
// future spec loads several multi-band stacks at once.

export function goToBandNumberInput(page: Page): Locator {
  return page.getByRole("textbox", { name: "Go to band number" });
}

export async function selectActiveBandNumber(page: Page, oneBasedBandNumber: number): Promise<void> {
  const input = goToBandNumberInput(page);
  await input.fill(String(oneBasedBandNumber));
  await input.press("Enter");
}

// The navigator's prev/next chevrons (aria-label "Previous band"/"Next band") and the
// "Active band" slider both move the displayed band by one step through the same debounced
// path the header label tracks (CT-094). With a single loaded multi-band panel each control
// is unambiguous at page scope.

export function previousBandButton(page: Page): Locator {
  return page.getByRole("button", { name: "Previous band" });
}

export function nextBandButton(page: Page): Locator {
  return page.getByRole("button", { name: "Next band" });
}

export async function stepToPreviousBand(page: Page): Promise<void> {
  await previousBandButton(page).click();
}

export async function stepToNextBand(page: Page): Promise<void> {
  await nextBandButton(page).click();
}

export function bandSliderThumb(page: Page): Locator {
  return page.locator('[aria-label="Active band"]').getByRole("slider");
}

const MAXIMUM_BAND_SLIDER_STEPS = 64;

export async function setActiveBandViaSlider(page: Page, oneBasedBandNumber: number): Promise<void> {
  const targetIndex = oneBasedBandNumber - 1;
  const thumb = bandSliderThumb(page);
  await thumb.focus();
  await pressBandSliderThumbTowardIndex(thumb, targetIndex);
  await expect(thumb).toHaveAttribute("aria-valuenow", String(targetIndex));
}

async function pressBandSliderThumbTowardIndex(thumb: Locator, targetIndex: number): Promise<void> {
  for (let attempt = 0; attempt < MAXIMUM_BAND_SLIDER_STEPS; attempt += 1) {
    const current = Number(await thumb.getAttribute("aria-valuenow"));
    if (current === targetIndex) return;
    await thumb.press(current < targetIndex ? "ArrowRight" : "ArrowLeft");
  }
  throw new Error(`Band slider did not reach band index ${targetIndex}`);
}

// The navigator's root flex container holds the "Go to band number" input directly, so its
// parent is the whole band-slider strip. CT-093 explicitly REJECTED annotating the slider
// with the original band index/wavelength (that information lives in the Metadata panel), so
// this asserts the strip carries no "#N" original-index badge and no "<n> nm" wavelength.
export function bandNavigatorStrip(page: Page): Locator {
  return goToBandNumberInput(page).locator("xpath=..");
}

export async function expectNoOriginalBandAnnotationBesideBandSlider(page: Page): Promise<void> {
  const strip = bandNavigatorStrip(page);
  await expect(strip.locator("[title^='Original band']")).toHaveCount(0);
  expect(await strip.innerText()).not.toMatch(/nm|#\d/);
}
