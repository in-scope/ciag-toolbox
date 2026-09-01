import { expect, test } from "@playwright/test";
import { join } from "node:path";
import type { Page } from "@playwright/test";

import {
  fixturePath,
  lowContrastGrayPng,
  maskMultibandPng,
  multiBandTiff,
} from "./fixtures/fixture-manifest";
import {
  readBundleEntriesAndManifest,
  writeLegacyVersionTwoBundle,
} from "./support/legacy-project-bundle";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  clickPanelToSelect,
  createTemporaryExportDirectory,
  createTemporaryProjectBundleDirectory,
  expectPixelReadoutToEqual,
  exportSelectedMaskAndDecodeIndexPng,
  importMaskFromPath,
  loadFixtureAsStack,
  maskCategoryNameField,
  maskLayerNameField,
  maskLayerOpacitySlider,
  maskLayerOptions,
  masksOptionsPanel,
  openMasksOptions,
  openProjectBundleThroughOpenDialog,
  saveProjectBundleThroughSaveDialog,
  selectPanel,
} from "./support/page-objects";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-306: masks live in the project bundle. The round trip imports
// mask-multiband.png (4x4 over multiband-12bit.tif, top row category 1, bottom
// row category 2, categories Parchment/Substrate, opacity 60) onto the stack,
// saves the bundle, reopens it, and exports the restored mask; the oracle is a
// REFERENCE DECODER (sharp) reading the exported zip's index PNG back
// sample-for-sample
// against the fixture's pinned values. The second test opens a hand-built
// version 2 bundle (no masks array at all) to prove an older project still
// loads, with the status-bar pixel readout as the oracle.

const PANEL = 1;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("a mask survives saving, closing, and reopening the project", async () => {
  const page = launched.window;
  await loadFixtureAsStack(page, multiBandTiff.fileName);
  await selectPanel(page, PANEL);
  await openMasksOptions(page);
  await importMaskFromPath(page, fixturePath(maskMultibandPng.fileName));
  await expect(maskLayerOptions(page)).toHaveCount(1);

  const bundlePath = join(await createTemporaryProjectBundleDirectory(), "masked.ctbundle");
  await saveProjectBundleThroughSaveDialog({ app: launched.app, page, destinationPath: bundlePath });
  await expectBundleCarriesTheMaskAsset(page, bundlePath);
  await openProjectBundleThroughOpenDialog({ app: launched.app, page, bundlePath });

  await selectRestoredPanelAndReadItsMaskLayers(page);
  await expectRestoredLayerKeptItsLabelling(page);
  await expectExportedMaskMatchesTheFixture(page);
});

test("a version 2 bundle written before masks existed still opens", async () => {
  const page = launched.window;
  const bundlePath = await writeLegacyVersionTwoBundle([
    {
      index: 0,
      fileName: lowContrastGrayPng.fileName,
      assetSourcePath: fixturePath(lowContrastGrayPng.fileName),
      assetExtension: "png",
    },
  ]);

  await openProjectBundleThroughOpenDialog({ app: launched.app, page, bundlePath });

  await expectLegacyBundlePixelOracle(page);
});

async function expectBundleCarriesTheMaskAsset(
  page: Page,
  bundlePath: string,
): Promise<void> {
  await runAsStoryboardStep(page, "Read the saved bundle's entries and manifest", async () => {
    const bundle = await readBundleEntriesAndManifest(bundlePath);
    expect(bundle.entryNames).toContain("assets/viewport-0-mask-0.png");
    expect(bundle.manifest.formatVersion).toBe(3);
    expect(bundle.manifest.viewports[0]!.masks[0]!.relativePath).toBe(
      "assets/viewport-0-mask-0.png",
    );
    expect(bundle.manifest.viewports[0]!.selectedMaskIndex).toBe(0);
  });
}

// The Masks tool is an app-wide mode, so it is still on after the reopen; the
// aside just follows the ACTIVE panel. Selecting through the corner badge strip
// keeps the CT-304 brush from painting the panel (progress.txt Codebase
// Patterns). A restored mask layer means the layer list is no longer empty.
async function selectRestoredPanelAndReadItsMaskLayers(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Read the reopened panel's mask layers", async () => {
    await clickPanelToSelect(page, PANEL);
    await expect(masksOptionsPanel(page)).toBeVisible();
    await expect(maskLayerOptions(page)).toHaveCount(1);
  });
}

async function expectRestoredLayerKeptItsLabelling(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Check the restored layer's names, colours, and opacity", async () => {
    await expect(maskLayerNameField(page)).toHaveValue(maskMultibandPng.name ?? "");
    await expect(maskCategoryNameField(page, 1)).toHaveValue(readCategoryName(0));
    await expect(maskCategoryNameField(page, 2)).toHaveValue(readCategoryName(1));
    await expect(maskLayerOpacitySlider(page)).toHaveAttribute(
      "aria-valuenow",
      String(maskMultibandPng.opacity),
    );
  });
}

function readCategoryName(position: number): string {
  return maskMultibandPng.categories?.[position]?.name ?? "";
}

async function expectExportedMaskMatchesTheFixture(page: Page): Promise<void> {
  const exportPath = join(await createTemporaryExportDirectory(), "restored-mask.zip");
  const decoded = await exportSelectedMaskAndDecodeIndexPng(page, exportPath);
  await runAsStoryboardStep(page, "Check the restored mask's exported index PNG", async () => {
    expect({
      width: decoded.width,
      height: decoded.height,
      channels: decoded.channels,
    }).toEqual({
      width: maskMultibandPng.width,
      height: maskMultibandPng.height,
      channels: 1,
    });
    expect(decoded.values).toEqual([...maskMultibandPng.values]);
  });
}

async function expectLegacyBundlePixelOracle(page: Page): Promise<void> {
  await runAsStoryboardStep(page, "Read the legacy bundle's pixels from the status bar", async () => {
    for (const sample of lowContrastGrayPng.samplePixels) {
      await expectPixelReadoutToEqual(page, {
        panel: PANEL,
        imageX: sample.x,
        imageY: sample.y,
        dimensions: { width: lowContrastGrayPng.width, height: lowContrastGrayPng.height },
        expected: sample.valuesPerBand[0]!,
      });
    }
  });
}
