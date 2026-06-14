import { expect } from "@playwright/test";
import { basename } from "node:path";
import type { Page } from "@playwright/test";

import { fixturePath } from "../fixtures/fixture-manifest";
import { enqueueOpenDialogPaths } from "./dialog-stub-controls";
import { applicationToolbar } from "./operations";

// Loads one committed fixture file as a single stack through the CT-113 dialog stub:
// enqueue the fixture path, then trigger the toolbar "Open image" control so the real
// load pipeline runs. ENVI fixtures pass only the ".hdr" path; the main-process stub
// returns the binary sibling as the sidecar automatically. The promise resolves once
// the stack's filename is visible in the panel (its header label).

export async function loadFixtureAsStack(page: Page, fixtureFileName: string): Promise<void> {
  await enqueueOpenDialogPaths(page, [fixturePath(fixtureFileName)]);
  await openImageFromToolbar(page);
  await expect(loadedStackLabel(page, fixtureFileName)).toBeVisible();
}

async function openImageFromToolbar(page: Page): Promise<void> {
  await applicationToolbar(page).getByRole("button", { name: "Open image" }).click();
}

function loadedStackLabel(page: Page, fixtureFileName: string) {
  return page.getByText(basename(fixtureFileName), { exact: false }).first();
}
