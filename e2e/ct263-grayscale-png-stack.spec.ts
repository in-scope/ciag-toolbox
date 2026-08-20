import { expect, test } from "@playwright/test";

import { fixturePath, lowContrastGrayPng } from "./fixtures/fixture-manifest";
import {
  writeTemporaryGrayscalePngVariantFixtures,
  type GrayscalePngVariantFixtureFile,
} from "./support/create-temporary-png-fixture";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  confirmReviewModal,
  enqueueAndTriggerOpenImages,
  openImagesReviewModal,
  readMetadata,
  readPixelValueAt,
  reviewModalGroups,
  reviewModalRows,
  selectActiveBandNumber,
} from "./support/page-objects";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-263: grayscale PNGs decode to single-band rasters and are therefore
// STACKABLE planes - opening several together proposes one combined stack in
// the review modal, and confirming it yields one multi-band panel whose band
// count equals the file count. Fixtures: the committed low-contrast-gray.png
// (4x4, value 100 at pixel 0,0) plus two temp-generated 4x4 uniform-value
// grayscale variants (30 and 220). Oracles: the Metadata section's band count
// and the pixel-readout status bar, one known value per band at pixel (0,0).

const PANEL = 1;
const STACK_DIMENSIONS = { width: lowContrastGrayPng.width, height: lowContrastGrayPng.height };
const LOW_CONTRAST_VALUE_AT_ORIGIN = lowContrastGrayPng.samplePixels[0]!.valuesPerBand[0]!;

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("three grayscale PNGs combine into one 3-band stack through the review modal", async () => {
  const variants = await writeTemporaryGrayscalePngVariantFixtures();
  await enqueueAndTriggerOpenImages(launched.window, [
    fixturePath(lowContrastGrayPng.fileName),
    ...variants.map((variant) => variant.filePath),
  ]);

  await expectReviewModalProposesOneStackOfThreeGrayscaleRows();
  await confirmReviewModal(launched.window);
  await expectPanelHoldsThreeBandStack();
  await expectEachBandCarriesItsSourceFileValueAndLabel(variants);
});

async function expectReviewModalProposesOneStackOfThreeGrayscaleRows(): Promise<void> {
  await runAsStoryboardStep(
    launched.window,
    "Review modal proposes one combined stack of the three grayscale PNGs",
    async () => {
      await expect(openImagesReviewModal(launched.window)).toBeVisible();
      await expect(reviewModalGroups(launched.window)).toHaveCount(1);
      await expect(
        openImagesReviewModal(launched.window).getByLabel(/^Multi-band Stack 1 \(3 rows\)/),
      ).toBeVisible();
      await expect(reviewModalRows(launched.window)).toHaveCount(3);
    },
  );
}

async function expectPanelHoldsThreeBandStack(): Promise<void> {
  await runAsStoryboardStep(
    launched.window,
    "Metadata reports a 3-band stack",
    async () => {
      const metadata = await readMetadata(launched.window);
      expect(metadata.bandCount).toBe("3");
    },
  );
}

async function expectEachBandCarriesItsSourceFileValueAndLabel(
  variants: ReadonlyArray<GrayscalePngVariantFixtureFile>,
): Promise<void> {
  await runAsStoryboardStep(
    launched.window,
    "Each band reads its source file's known pixel value with a per-file band label",
    async () => {
      const readouts = await readOriginPixelPerBand();
      const expectedValues = [
        LOW_CONTRAST_VALUE_AT_ORIGIN,
        ...variants.map((variant) => variant.uniformValue),
      ];
      expect([...readouts.map((readout) => readout.value)].sort((a, b) => a - b)).toEqual(
        [...expectedValues].sort((a, b) => a - b),
      );
      expectDistinctNonEmptyBandLabels(readouts.map((readout) => readout.bandLabel));
    },
  );
}

interface BandOriginReadout {
  readonly bandLabel: string | null;
  readonly value: number;
}

async function readOriginPixelPerBand(): Promise<ReadonlyArray<BandOriginReadout>> {
  const readouts: BandOriginReadout[] = [];
  for (let bandNumber = 1; bandNumber <= 3; bandNumber += 1) {
    await selectActiveBandNumber(launched.window, bandNumber);
    const readout = await readPixelValueAt(launched.window, PANEL, 0, 0, STACK_DIMENSIONS);
    readouts.push({ bandLabel: readout.bandLabel, value: Number.parseInt(readout.value, 10) });
  }
  return readouts;
}

function expectDistinctNonEmptyBandLabels(labels: ReadonlyArray<string | null>): void {
  for (const label of labels) {
    expect(label, "every band carries a per-file label").toBeTruthy();
  }
  expect(new Set(labels).size).toBe(labels.length);
}
