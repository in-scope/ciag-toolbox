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
