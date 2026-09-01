import { expect, test } from "@playwright/test";
import { join } from "node:path";
import sharp from "sharp";
import type { Page } from "@playwright/test";

import { builtinScriptReferences, fixturePath, maskMultibandPng, multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperation,
  closeMasksOptions,
  expectHistoryToRecordOperation,
  expectPixelReadoutToEqual,
  importMaskFromPath,
  isApplyEnabled,
  loadFixtureAsStack,
  openMasksOptions,
  openOperation,
  operationPanel,
  readMetadata,
  selectPanel,
  type PixelDimensions,
} from "./support/page-objects";
import {
  expectL2MinimizationDefaultsToTheLayer,
  L2_MINIMIZATION_LABEL,
} from "./support/l2-minimization-operation";
import { selectActiveBandNumber } from "./support/band-navigator";
import {
  createTemporaryExportDirectory,
  exportSelectedStackThroughSaveDialog,
} from "./support/save-image-flow";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-313: L2 minimization - the client's L2 binarization approximation
// (resources/builtin-python/l2_minimization.py, packaged and parity-pinned by
// CT-307), driven by the active panel's mask layer. Unlike Local PCA/MNF this
// operation needs a qualifying mask layer, so it gates Apply the same way NPC
// gates Compute.
//
// FIXTURE: multiband-12bit.tif (4x4x3 uint16) + mask-multiband.png (top row
// "Parchment", bottom row "Substrate").
//
// ORACLE: builtinScriptReferences.l2Minimization - the output the CT-307
// reference runner produced by executing the SAME script with the bundled
// runtime and NO params (the script's own defaults, lowerVal 0 / upperVal 1),
// pinned in manifest.json. Every pixel is asserted through the status-bar
// pixel readout at 1e-4 relative tolerance.

const SOURCE_PANEL = 1;
const RESULT_PANEL = 2;
const IMAGE: PixelDimensions = { width: multiBandTiff.width, height: multiBandTiff.height };
const REFERENCE = builtinScriptReferences.l2Minimization;
const RELATIVE_TOLERANCE = 1e-4;
const MASK_LAYER_NAME = maskMultibandPng.name ?? "Parchment mask";
const DEFAULT_APPLIED_LABEL = `L2 Minimization (${MASK_LAYER_NAME}, lower 0, upper 1)`;

// The readout formats floats to four significant figures, so a parity
// assertion through the status bar allows the tolerance plus half the display
// quantum, exactly as the Local PCA/MNF specs do.
function readoutToleranceFor(referenceValue: number): number {
  const magnitude = Math.floor(Math.log10(Math.abs(referenceValue)));
  return Math.abs(referenceValue) * RELATIVE_TOLERANCE + 10 ** (magnitude - 3) / 2;
}

function referenceValueAtPixel(x: number, y: number): number {
  const value = REFERENCE.values[y * IMAGE.width + x];
  if (value === undefined) throw new Error(`l2_minimization reference is missing (${x}, ${y})`);
  return value;
}

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
  await selectPanel(launched.window, SOURCE_PANEL);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("fits a linear combination of bands to the masked classes, matching the pinned reference", async () => {
  const page = launched.window;

  await importTheParchmentMask(page);
  await openOperation(page, L2_MINIMIZATION_LABEL);
  await expectL2MinimizationDefaultsToTheLayer(page, MASK_LAYER_NAME);
  await applyOperation(page, L2_MINIMIZATION_LABEL);

  await selectPanel(page, RESULT_PANEL);
  await expectResultIsASingleFloatBand(page);
  await expectResultMatchesThePinnedReference(page);
  await expectHistoryToRecordOperation(page, {
    actionLabel: L2_MINIMIZATION_LABEL,
    detailSubstrings: [DEFAULT_APPLIED_LABEL],
  });
});

test("blocks Apply until the stack has a mask layer with two painted categories", async () => {
  const page = launched.window;

  await openOperation(page, L2_MINIMIZATION_LABEL);
  await expectPanelBlockedWithAnExplanation(page);
  await cancelOperationPanel(page);

  await importTheParchmentMask(page);
  await openOperation(page, L2_MINIMIZATION_LABEL);
  expect(await isApplyEnabled(page, L2_MINIMIZATION_LABEL)).toBe(true);
});

// CT-324: the result inherits the source panel's rendering state, and this
// source is being viewed at its LAST band while the result has only one. An
// inherited band index the result raster does not have used to break the save
// with "Band index N out of range" (the reason Anna could not export an L2 /
// Local PCA-MNF / ROP result).
//
// ORACLE: the saved PNG decodes (sharp, an independent decoder) to the result
// raster's width x height, which is only reachable if the save read a band the
// result actually has.
test("saves a one-band result exported after viewing the source at its last band", async () => {
  const page = launched.window;

  await importTheParchmentMask(page);
  await viewTheLastBandOfTheSource(page);
  await openOperation(page, L2_MINIMIZATION_LABEL);
  await applyOperation(page, L2_MINIMIZATION_LABEL);

  await selectPanel(page, RESULT_PANEL);
  await expectResultIsASingleFloatBand(page);
  await expectTheResultSavesAsAPngOfItsOwnSize(page);
});

async function viewTheLastBandOfTheSource(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "View the last band of the source stack", async () => {
    await selectActiveBandNumber(page, multiBandTiff.bandCount);
  });
}

async function expectTheResultSavesAsAPngOfItsOwnSize(page: Page): Promise<void> {
  const destinationPath = join(await createTemporaryExportDirectory(), "l2-result.png");
  await exportSelectedStackThroughSaveDialog({
    app: launched.app,
    page,
    formatLabel: "PNG (8-bit)",
    destinationPath,
  });
  await expectSavedPngToDecodeToTheResultSize(page, destinationPath);
}

async function expectSavedPngToDecodeToTheResultSize(
  page: Page,
  destinationPath: string,
): Promise<void> {
  await runAsStoryboardStep(page, "Reference-decode the saved result PNG", async () => {
    const metadata = await sharp(destinationPath).metadata();
    expect(metadata).toMatchObject({ width: IMAGE.width, height: IMAGE.height });
  });
}

async function importTheParchmentMask(page: Page): Promise<void> {
  await openMasksOptions(page);
  await importMaskFromPath(page, fixturePath(maskMultibandPng.fileName));
  await closeMasksOptions(page);
}

async function cancelOperationPanel(page: Page): Promise<void> {
  await runAsStoryboardStep(page, `Cancel the ${L2_MINIMIZATION_LABEL} panel`, async () => {
    await operationPanel(page, L2_MINIMIZATION_LABEL)
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(operationPanel(page, L2_MINIMIZATION_LABEL)).toBeHidden();
  });
}

async function expectPanelBlockedWithAnExplanation(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "The panel with no mask layers blocks Apply", async () => {
    expect(await isApplyEnabled(page, L2_MINIMIZATION_LABEL)).toBe(false);
    await expect(operationPanel(page, L2_MINIMIZATION_LABEL)).toContainText("No usable mask layer");
  });
}

async function expectResultIsASingleFloatBand(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "The result is one labelled float band", async () => {
    const metadata = await readMetadata(page);
    expect(metadata.bandCount).toBe("1");
    await expect(page.getByText("L2 Minimization 1").first()).toBeVisible();
  });
}

async function expectResultMatchesThePinnedReference(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Every pixel matches the pinned reference output", async () => {
    for (let y = 0; y < IMAGE.height; y += 1) {
      for (let x = 0; x < IMAGE.width; x += 1) {
        const expected = referenceValueAtPixel(x, y);
        await expectPixelReadoutToEqual(page, {
          panel: RESULT_PANEL,
          imageX: x,
          imageY: y,
          dimensions: IMAGE,
          expected,
          tolerance: readoutToleranceFor(expected),
        });
      }
    }
  });
}
