import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { panelCell } from "./panels";

// CT-193: the per-panel "Fixed [0,1] float view" toggle is a Button in each float
// panel's always-on header strip (inside the role="gridcell"). It carries aria-pressed
// and an accessible name that gains an "(on)" suffix when enabled ("Fixed [0,1] float
// view" / "Fixed [0,1] float view (on)"), so match it by the label PREFIX to stay
// state-independent and scope it to the panel cell. The toggle is display-only: it pins
// out-of-range float data to the fixed [0,1] window instead of auto-stretching it, with
// no change to pixel data or History.

export function fixedUnitFloatViewToggle(page: Page, panelNumber: number): Locator {
  return panelCell(page, panelNumber).getByRole("button", { name: /^Fixed \[0,1\] float view/ });
}

export async function toggleFixedUnitFloatView(page: Page, panelNumber: number): Promise<void> {
  await fixedUnitFloatViewToggle(page, panelNumber).click();
}

export async function expectFixedUnitFloatViewEnabled(
  page: Page,
  panelNumber: number,
  enabled: boolean,
): Promise<void> {
  await expect(fixedUnitFloatViewToggle(page, panelNumber)).toHaveAttribute(
    "aria-pressed",
    String(enabled),
  );
}
