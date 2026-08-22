import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { panelCell } from "./panels";

// CT-248/CT-295: the per-panel channel-view toggle is a Button in a colour-photo
// panel's header strip (inside the role="gridcell"), the same placement family as
// the CT-193 fixed [0,1] float-view toggle. It carries the STABLE accessible name
// "RGB color composite" in both states (the CT-259 pattern: aria-label never
// changes, aria-pressed carries the state - true while the composite is shown,
// false while channels are viewed separately). It renders ONLY for true-colour
// composites, so a scientific stack's panel matches this locator zero times. The
// toggle is display-only and in-memory: no pixel change, no History entry, not
// persisted in project bundles, resets to the composite on reopen.

export const RGB_COMPOSITE_TOGGLE_LABEL = "RGB color composite";

export function channelViewToggle(page: Page, panelNumber: number): Locator {
  return panelCell(page, panelNumber).getByRole("button", { name: RGB_COMPOSITE_TOGGLE_LABEL });
}

export async function toggleChannelView(page: Page, panelNumber: number): Promise<void> {
  await channelViewToggle(page, panelNumber).click();
}

export async function expectChannelViewEnabled(
  page: Page,
  panelNumber: number,
  enabled: boolean,
): Promise<void> {
  const toggle = channelViewToggle(page, panelNumber);
  await expect(toggle).toHaveAttribute("aria-pressed", String(!enabled));
  await expect(toggle).toHaveAccessibleName(RGB_COMPOSITE_TOGGLE_LABEL);
}
