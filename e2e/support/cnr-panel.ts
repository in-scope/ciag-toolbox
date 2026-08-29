import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { runAsStoryboardStep } from "./storyboard-step";

// CT-320: "CNR" is a menu-only Multi-band command that opens
// <aside aria-label="CNR options">. It reads like the NPC aside - one score per
// band, presented as a line plot plus a "Top bands" list of
// <output aria-label="CNR top band N"> - but the user picks which category is
// the text and which is the background, and it never places a raster, so it has
// a Compute button instead of Apply.

export const CNR_PANEL_LABEL = "CNR";
export const CNR_NOT_COMPUTED_TEXT = "Not computed yet";

export function cnrOptionsPanel(page: Page): Locator {
  return page.locator('aside[aria-label="CNR options"]');
}

export function cnrMaskLayerPicker(page: Page): Locator {
  return cnrOptionsPanel(page).getByRole("combobox", { name: "Mask layer" });
}

export function cnrTextCategoryPicker(page: Page): Locator {
  return cnrOptionsPanel(page).getByRole("combobox", { name: "Text category" });
}

export function cnrBackgroundCategoryPicker(page: Page): Locator {
  return cnrOptionsPanel(page).getByRole("combobox", { name: "Background category" });
}

export function cnrComputeButton(page: Page): Locator {
  return cnrOptionsPanel(page).getByRole("button", { name: /^Compute/ });
}

export function cnrScoresSection(page: Page): Locator {
  return cnrOptionsPanel(page).locator('section[aria-label="CNR scores"]');
}

export function cnrScorePlot(page: Page): Locator {
  return cnrScoresSection(page).locator("figure");
}

export function cnrTopBandRows(page: Page): Locator {
  return cnrScoresSection(page).locator('output[aria-label^="CNR top band "]');
}

export async function chooseCnrTextCategory(page: Page, categoryName: string): Promise<void> {
  await runAsStoryboardStep(page, `Set the CNR text category to ${categoryName}`, async () => {
    await cnrTextCategoryPicker(page).selectOption({ label: categoryName });
  });
}

export async function chooseCnrBackgroundCategory(
  page: Page,
  categoryName: string,
): Promise<void> {
  await runAsStoryboardStep(
    page,
    `Set the CNR background category to ${categoryName}`,
    async () => {
      await cnrBackgroundCategoryPicker(page).selectOption({ label: categoryName });
    },
  );
}

export interface CnrTopBandRowReadout {
  readonly bandIdentityText: string;
  readonly scoreText: string;
}

// Any settings change clears the section, so its pre-click state is the
// baseline: rows appearing after the click are THIS run's answer. Waiting for
// the cleared state to flash by after the click would be a race - CNR runs on
// the renderer thread, so a small stack finishes within one frame.
export async function computeCnrScores(page: Page): Promise<CnrTopBandRowReadout[]> {
  return runAsStoryboardStep(page, "Compute the CNR scores and read the top bands", async () => {
    await expect(cnrScoresSection(page)).toHaveText(CNR_NOT_COMPUTED_TEXT);
    await cnrComputeButton(page).click();
    await expect(cnrTopBandRows(page).first()).toBeVisible({ timeout: CNR_RUN_TIMEOUT_MS });
    return readCnrTopBandRows(page);
  });
}

export async function readCnrTopBandRows(page: Page): Promise<CnrTopBandRowReadout[]> {
  const rowTexts = await cnrTopBandRows(page).allInnerTexts();
  return rowTexts.map(splitTopBandRowText);
}

function splitTopBandRowText(rowText: string): CnrTopBandRowReadout {
  const parts = rowText.split(/\s+/).filter((part) => part.length > 0);
  const scoreText = parts[parts.length - 1] ?? "";
  return { bandIdentityText: parts.slice(0, -1).join(" "), scoreText };
}

const CNR_RUN_TIMEOUT_MS = 30_000;
