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

// CT-259: the toggle's tooltip explains what each state does (the aria-label above stays
// the stable "Fixed [0,1] float view" name). Hovering the button reveals the copy for the
// CURRENT state; a click closes the tooltip, so move the pointer away and re-hover before
// reading the other state's copy.
export const FIXED_UNIT_FLOAT_VIEW_OFF_TOOLTIP =
  "Display is stretched to this band's own value range. Click to switch to the fixed 0 to 1 scale: 0 shows black, 1 shows white, values outside clip. Display only, data never changes.";
export const FIXED_UNIT_FLOAT_VIEW_ON_TOOLTIP =
  "Fixed 0 to 1 display scale: 0 shows black, 1 shows white, values outside clip. Click to stretch the display to this band's own value range. Display only, data never changes.";

export async function expectFixedUnitFloatViewTooltip(
  page: Page,
  panelNumber: number,
  tooltipCopy: string,
): Promise<void> {
  await fixedUnitFloatViewToggle(page, panelNumber).hover();
  await expect(page.getByRole("tooltip").filter({ hasText: tooltipCopy })).toBeVisible();
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
