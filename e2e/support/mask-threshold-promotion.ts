import type { Locator, Page } from "@playwright/test";

import { masksOptionsPanel } from "./masks-panel";
import { runAsStoryboardStep } from "./storyboard-step";

// CT-305: the Masks aside's "From threshold result" control. It offers open
// panels that match this stack's size AND are a plain two-level 8-bit stack
// (a Threshold result), plus the band picker for the chosen panel; Promote
// assigns the picked band's white pixels to the currently selected category.

export function promoteThresholdResultSection(page: Page): Locator {
  return masksOptionsPanel(page).locator('[aria-label="Promote threshold result"]');
}

export function sourcePanelMenuTrigger(page: Page): Locator {
  return promoteThresholdResultSection(page).getByRole("button", { name: "Source panel" });
}

export function sourceBandMenuTrigger(page: Page): Locator {
  return promoteThresholdResultSection(page).getByRole("button", { name: "Source band" });
}

export function promoteThresholdResultButton(page: Page): Locator {
  return promoteThresholdResultSection(page).getByRole("button", { name: /^Promote to/ });
}

export function noQualifyingThresholdResultHint(page: Page): Locator {
  return promoteThresholdResultSection(page).getByText(
    "No open stack is a threshold result matching this stack's width and height.",
    { exact: false },
  );
}

// Only one candidate is expected in these specs, so the picker is driven by
// position rather than by the loaded panel's exact display label.
export async function promoteFirstQualifyingThresholdResult(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Promote the qualifying threshold result", async () => {
    await sourcePanelMenuTrigger(page).click();
    await page.getByRole("menu").getByRole("menuitem").first().click();
    await promoteThresholdResultButton(page).click();
  });
}
