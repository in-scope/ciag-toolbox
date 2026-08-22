import { expect, test } from "@playwright/test";

import { gradientGray16Png } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import { expectPixelReadoutToEqual } from "./support/assertions";
import { loadFixtureAsStack, readMetadata, selectPanel } from "./support/page-objects";
import { runAsStoryboardStep } from "./support/storyboard-step";

// CT-272: opening a 16-bit PNG must yield the REAL uint16 samples, not
// Chromium's silent 8-bit downscale. gradient-gray16.png was written by
// sharp/libvips (an external reference encoder); every pixel value exceeds
// 255 (value = 300 + index*500), so the pixel-readout oracle can only report
// these numbers if the main-process Node-zlib decode path ran. Metadata must
// also report 16 bits per sample (a downscaled decode would read 8).

const PANEL = 1;
const DIMENSIONS = { width: gradientGray16Png.width, height: gradientGray16Png.height };

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("a 16-bit PNG opens with exact uint16 values and 16 bits per sample", async () => {
  await loadFixtureAsStack(launched.window, gradientGray16Png.fileName);
  await selectPanel(launched.window, PANEL);
  await expectMetadataReportsSixteenBitGrayscale();
  await expectEveryPinnedPixelKeepsItsExactValueAbove255();
});

async function expectMetadataReportsSixteenBitGrayscale(): Promise<void> {
  await runAsStoryboardStep(launched.window, "Metadata reports uint16 at the source size", async () => {
    const metadata = await readMetadata(launched.window);
    expect(metadata.bitsPerSample).toBe("16");
    expect(metadata.sampleFormat).toBe("uint");
    expect(metadata.width).toBe(String(gradientGray16Png.width));
    expect(metadata.height).toBe(String(gradientGray16Png.height));
    expect(metadata.bandCount).toBe(String(gradientGray16Png.bandCount));
  });
}

async function expectEveryPinnedPixelKeepsItsExactValueAbove255(): Promise<void> {
  await runAsStoryboardStep(launched.window, "Pinned pixels read back their exact 16-bit values", async () => {
    for (const pixel of gradientGray16Png.samplePixels) {
      const expected = pixel.valuesPerBand[0]!;
      expect(expected).toBeGreaterThan(255);
      await expectPixelReadoutToEqual(launched.window, {
        panel: PANEL,
        imageX: pixel.x,
        imageY: pixel.y,
        dimensions: DIMENSIONS,
        expected,
      });
    }
  });
}
