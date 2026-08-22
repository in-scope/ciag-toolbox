import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { runAsStoryboardStep } from "./storyboard-step";

// CT-308: "NPC" is a menu-only Multi-band command that opens
// <aside aria-label="NPC options">. The panel computes a score and shows it to
// four significant figures; it never places a raster, so it has a Compute
// button instead of Apply and no result-destination control.

export const NPC_PANEL_LABEL = "NPC";
export const NPC_NOT_COMPUTED_TEXT = "Not computed yet";

export function npcOptionsPanel(page: Page): Locator {
  return page.locator('aside[aria-label="NPC options"]');
}

export function npcMaskLayerPicker(page: Page): Locator {
  return npcOptionsPanel(page).getByRole("combobox", { name: "Mask layer" });
}

export function npcBinsField(page: Page): Locator {
  return npcOptionsPanel(page).getByRole("spinbutton", { name: "Bins" });
}

export function npcComputeButton(page: Page): Locator {
  return npcOptionsPanel(page).getByRole("button", { name: /^Compute/ });
}

export function npcScoreReadout(page: Page): Locator {
  return npcOptionsPanel(page).locator('output[aria-label="NPC score"]');
}

export async function setNpcBinCount(page: Page, bins: number): Promise<void> {
  await runAsStoryboardStep(page, `Set the NPC bin count to ${bins}`, async () => {
    await npcBinsField(page).fill(String(bins));
    await expect(npcBinsField(page)).toHaveValue(String(bins));
  });
}

// Compute runs the packaged Python analysis out of process, so the readout only
// settles once the worker returns; waiting on the text leaving its placeholder
// (or changing) is the completion signal.
export async function computeNpcScore(page: Page): Promise<number> {
  return runAsStoryboardStep(page, "Compute the NPC score and read it back", async () => {
    const before = await npcScoreReadout(page).innerText();
    await npcComputeButton(page).click();
    await expect(npcScoreReadout(page)).not.toHaveText(before, { timeout: NPC_RUN_TIMEOUT_MS });
    return Number(await npcScoreReadout(page).innerText());
  });
}

const NPC_RUN_TIMEOUT_MS = 60_000;

export function expectScoreWithinRelativeTolerance(
  actual: number,
  expected: number,
  tolerance = 1e-4,
): void {
  const allowed = Math.max(Math.abs(expected), 1) * tolerance;
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(allowed);
}
