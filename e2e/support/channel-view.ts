import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { panelCell } from "./panels";

// CT-248: the per-panel channel-view toggle is a Button in a colour-photo panel's
// header strip (inside the role="gridcell"), the same placement family as the
// CT-193 fixed [0,1] float-view toggle. Its accessible name states the action the
// next click performs: "View channels separately" while the composite is shown,
// "View color image" while the channel view is active, with aria-pressed carrying
// the state. It renders ONLY for true-colour composites, so a scientific stack's
// panel matches this locator zero times. The toggle is display-only and
// in-memory: no pixel change, no History entry, not persisted in project
// bundles, resets to the composite on reopen.

const CHANNEL_VIEW_TOGGLE_NAME = /^View (channels separately|color image)$/;

export const VIEW_CHANNELS_SEPARATELY_LABEL = "View channels separately";
export const VIEW_COLOR_IMAGE_LABEL = "View color image";

export function channelViewToggle(page: Page, panelNumber: number): Locator {
  return panelCell(page, panelNumber).getByRole("button", { name: CHANNEL_VIEW_TOGGLE_NAME });
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
  await expect(toggle).toHaveAttribute("aria-pressed", String(enabled));
  await expect(toggle).toHaveAccessibleName(
    enabled ? VIEW_COLOR_IMAGE_LABEL : VIEW_CHANNELS_SEPARATELY_LABEL,
  );
}
