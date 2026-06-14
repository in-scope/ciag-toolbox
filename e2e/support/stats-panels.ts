import type { Locator, Page } from "@playwright/test";

// Region and Histogram panel readbacks.
//
// The Region section (<section aria-label="Region">) lists the inspection ROI as
// "Corners" and "Size" rows (a definition list), and is absent until an ROI exists.
// The Histogram section (<section aria-label="Histogram">) renders the active band's
// distribution as a canvas (role="img" "Active band intensity histogram") plus a band
// identity label; it exposes no textual min/max/mean, so numeric distribution claims
// must be derived from per-pixel readouts, not from this panel.

export interface RegionStatsReadout {
  readonly corners: string;
  readonly size: string;
}

export function regionSection(page: Page): Locator {
  return page.locator("section[aria-label='Region']");
}

export async function readRegionStats(page: Page): Promise<RegionStatsReadout> {
  const section = regionSection(page);
  return {
    corners: await readDefinitionRowValue(section, "Corners"),
    size: await readDefinitionRowValue(section, "Size"),
  };
}

export function histogramSection(page: Page): Locator {
  return page.locator("section[aria-label='Histogram']");
}

export function histogramCanvas(page: Page): Locator {
  return page.getByRole("img", { name: "Active band intensity histogram" });
}

export async function readHistogramActiveBandLabel(page: Page): Promise<string> {
  return (await histogramSection(page).locator("span[title]").first().innerText()).trim();
}

async function readDefinitionRowValue(section: Locator, label: string): Promise<string> {
  const value = section
    .locator("dt", { hasText: new RegExp(`^${label}$`) })
    .locator("xpath=following-sibling::dd[1]");
  return (await value.innerText()).trim();
}
