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
