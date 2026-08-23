import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { runAsStoryboardStep } from "./storyboard-step";

// CT-309: "ROP" is a menu-only Multi-band command that opens
// <aside aria-label="ROP options">. New projection previews a fresh random
// candidate in the source panel (display-only); Keep / Keep best commit a
// candidate as a new stack. Launch the app with MSI_E2E_ROP_FORCED_SEED to make
// every press reproduce the reference candidate pinned in manifest.json.

export const ROP_PANEL_LABEL = "ROP";
export const ROP_NO_CANDIDATE_TEXT = "No projection yet";

export function ropOptionsPanel(page: Page): Locator {
  return page.locator('aside[aria-label="ROP options"]');
}

export function ropObjectivePicker(page: Page): Locator {
  return ropOptionsPanel(page).getByRole("combobox", { name: "Objective" });
}

export function ropCnrTextCategoryPicker(page: Page): Locator {
  return ropOptionsPanel(page).getByRole("combobox", { name: "Text category" });
}

export function ropCnrBackgroundCategoryPicker(page: Page): Locator {
  return ropOptionsPanel(page).getByRole("combobox", { name: "Background category" });
}

export function ropNewProjectionButton(page: Page): Locator {
  return ropOptionsPanel(page).getByRole("button", { name: /^(New projection|Projecting)/ });
}

export function ropSeedReadout(page: Page): Locator {
  return ropOptionsPanel(page).locator('output[aria-label="ROP seed"]');
}

export function ropScoreReadout(page: Page): Locator {
  return ropOptionsPanel(page).locator('output[aria-label="ROP score"]');
}

export function ropBestScoreReadout(page: Page): Locator {
  return ropOptionsPanel(page).locator('output[aria-label="Best ROP score"]');
}

export function ropKeepButton(page: Page): Locator {
  return ropOptionsPanel(page).getByRole("button", { name: "Keep", exact: true });
}

export function ropKeepBestButton(page: Page): Locator {
  return ropOptionsPanel(page).getByRole("button", { name: "Keep best" });
}

export async function chooseRopObjective(page: Page, optionLabel: string): Promise<void> {
  await runAsStoryboardStep(page, `Choose the ${optionLabel} objective`, async () => {
    await ropObjectivePicker(page).selectOption({ label: optionLabel });
  });
}

// The first press spawns the Python worker and uploads the cube, so the
// completion signal (the seed readout showing the pressed seed) can take a
// while; later presses reuse the retained session and settle fast.
export async function pressNewProjectionUntilSeedShows(
  page: Page,
  expectedSeed: number,
): Promise<void> {
  await runAsStoryboardStep(page, `Press New projection (seed ${expectedSeed})`, async () => {
    await ropNewProjectionButton(page).click();
    await expect(ropSeedReadout(page)).toHaveText(`Seed ${expectedSeed}`, {
      timeout: ROP_RUN_TIMEOUT_MS,
    });
    await expect(ropNewProjectionButton(page)).toBeEnabled({ timeout: ROP_RUN_TIMEOUT_MS });
  });
}

export async function pressNewProjectionUntilScoreShows(
  page: Page,
  expectedScoreText: string,
): Promise<void> {
  await runAsStoryboardStep(page, "Press New projection and wait for its score", async () => {
    await ropNewProjectionButton(page).click();
    await expect(ropScoreReadout(page)).toHaveText(expectedScoreText, {
      timeout: ROP_RUN_TIMEOUT_MS,
    });
    await expect(ropNewProjectionButton(page)).toBeEnabled({ timeout: ROP_RUN_TIMEOUT_MS });
  });
}

const ROP_RUN_TIMEOUT_MS = 60_000;
