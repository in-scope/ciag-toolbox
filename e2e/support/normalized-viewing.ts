import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { panelCell } from "./panels";

// The per-panel "Normalized viewing" toggle is a Button in each viewport's always-on
// header strip (inside the role="gridcell"). It carries aria-pressed and an accessible
// name that gains an "(on)" suffix when enabled ("Normalized viewing" /
// "Normalized viewing (on)"), so match it by the label PREFIX to stay state-independent
// and scope it to the panel cell because every panel reuses the same name. The toggle is
// display-only and per-panel: it stretches the band's min/max to the screen range without
// changing data or recording History (manual sections 9.3 / 15.3).

export function normalizedViewingToggle(page: Page, panelNumber: number): Locator {
  return panelCell(page, panelNumber).getByRole("button", { name: /^Normalized viewing/ });
}

export async function toggleNormalizedViewing(page: Page, panelNumber: number): Promise<void> {
  await normalizedViewingToggle(page, panelNumber).click();
}

export async function expectNormalizedViewingEnabled(
  page: Page,
  panelNumber: number,
  enabled: boolean,
): Promise<void> {
  await expect(normalizedViewingToggle(page, panelNumber)).toHaveAttribute(
    "aria-pressed",
    String(enabled),
  );
}
