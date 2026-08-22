// CT-290: repeated large in-place applies never exhaust memory. An in-place
// rotate replaces the panel's cube; the replaced cube's band buffers must be
// DETACHED deterministically (ArrayBuffer.prototype.transfer(0)) instead of
// waiting for a GC that allocation failure never triggers. The oracle is the
// MSI_E2E-gated release instrumentation (window.__msiRasterReleaseInstrumentation):
// after each rotate at the Anna benchmark (1000 x 2000 x 49-band uint16,
// ~196 MB, generated on demand) the detached-buffer count must have grown by
// exactly the band count and the released bytes by exactly the cube size, so N
// consecutive rotates cost the same pool space as one. Correctness rides on
// the pixel-readout oracle: the benchmark's value(band, x, y) formula makes
// whatever pixel the status bar reports exactly checkable after composing the
// coordinate remap over all rotations so far.
//
// Run locally: dev server first (pnpm dev), then
//   MSI_E2E_TRACE_LABEL=CT-290 pnpm e2e ct290-memory-release.spec.ts
import { expect, test } from "@playwright/test";

import {
  ANNA_BENCHMARK_BAND_COUNT,
  ANNA_BENCHMARK_DIMENSIONS,
  ANNA_BENCHMARK_TIFF_PATH,
  annaBenchmarkValue,
  ensureAnnaBenchmarkFixtureExists,
} from "./anna-benchmark.support";
import {
  applyOperationWithBudget,
  openScale10SingleFile,
  readReportedPixelNear,
} from "./scale10.support";
import type { PixelDimensions } from "./support/image-pixel-canvas-mapping";
import { closeToolboxApp, launchToolboxApp, type LaunchedApp } from "./support/launch-app";
import { openOperation, setOpenInNewPanel } from "./support/operations";
import { selectPanel } from "./support/panels";
import { readRasterReleaseCounters } from "./support/raster-release-instrumentation";
import { runAsStoryboardStep } from "./support/storyboard-step";

const SOURCE_PANEL = 1;
const CONSECUTIVE_ROTATE_COUNT = 8;

const BAND_BYTES = ANNA_BENCHMARK_DIMENSIONS.width * ANNA_BENCHMARK_DIMENSIONS.height * 2;
const CUBE_BYTES = BAND_BYTES * ANNA_BENCHMARK_BAND_COUNT;

// 5 s dev-machine apply target x 3 CI headroom (the CT-267 bounds).
const APPLY_BOUND_MS = 5_000 * 3;
const RELEASE_FLUSH_TIMEOUT_MS = 30_000;
const OPEN_BUDGET_MS = 4 * 60_000;
const TEST_TIMEOUT_MS = 20 * 60_000;

let launched: LaunchedApp;

test.beforeAll(() => {
  ensureAnnaBenchmarkFixtureExists();
});

test.beforeEach(async () => {
  launched = await launchToolboxApp();
});

test.afterEach(async () => {
  if (!launched) return;
  try {
    await closeToolboxApp(launched);
  } catch {
    await launched.app.close().catch(() => undefined);
  }
});

test("eight consecutive in-place rotates each detach the replaced cube and keep exact pixels", async () => {
  test.setTimeout(TEST_TIMEOUT_MS);
  await openScale10SingleFile(launched.window, ANNA_BENCHMARK_TIFF_PATH, OPEN_BUDGET_MS);
  let dimensions: PixelDimensions = { ...ANNA_BENCHMARK_DIMENSIONS };
  for (let rotation = 1; rotation <= CONSECUTIVE_ROTATE_COUNT; rotation += 1) {
    await rotateSourcePanelInPlace(rotation);
    dimensions = { width: dimensions.height, height: dimensions.width };
    await expectWholeReplacedCubeWasDetached(rotation);
    await verifyRotatedPixelReadout(rotation, dimensions);
  }
});

// Rotate defaults to "Rotate 90 clockwise" (the first enum choice); the
// "Open in a new panel" switch is turned OFF so the result replaces the
// source panel's cube in place.
async function rotateSourcePanelInPlace(rotation: number): Promise<void> {
  await runAsStoryboardStep(launched.window, `In-place rotate ${rotation}`, async () => {
    await selectPanel(launched.window, SOURCE_PANEL);
    await openOperation(launched.window, "Rotate");
    await setOpenInNewPanel(launched.window, "Rotate", false);
    await applyOperationWithBudget(launched.window, "Rotate", APPLY_BOUND_MS);
  });
}

// The release flush runs in a post-commit React effect, so the counters are
// polled. Exact equality is the point: every band buffer of every replaced
// cube must be detached, no more and no fewer.
async function expectWholeReplacedCubeWasDetached(rotation: number): Promise<void> {
  await runAsStoryboardStep(
    launched.window,
    `Assert replaced cube ${rotation} was detached (bands and bytes exact)`,
    async () => {
      await expect
        .poll(async () => (await readRasterReleaseCounters(launched.window)).detachedBufferCount, {
          timeout: RELEASE_FLUSH_TIMEOUT_MS,
        })
        .toBe(ANNA_BENCHMARK_BAND_COUNT * rotation);
      const counters = await readRasterReleaseCounters(launched.window);
      expect(counters.releasedByteCount).toBe(CUBE_BYTES * rotation);
    },
  );
}

async function verifyRotatedPixelReadout(
  rotation: number,
  dimensions: PixelDimensions,
): Promise<void> {
  await runAsStoryboardStep(
    launched.window,
    `Verify the pixel readout after rotate ${rotation}`,
    async () => {
      const probe = {
        x: Math.floor(dimensions.width * 0.35),
        y: Math.floor(dimensions.height * 0.3),
      };
      const reported = await readReportedPixelNear(launched.window, SOURCE_PANEL, probe, dimensions);
      const original = mapResultPixelBackToOriginal(rotation, reported, dimensions);
      expect(reported.value).toBe(annaBenchmarkValue(0, original.x, original.y));
    },
  );
}

// Rotate 90 clockwise maps source (x, y) to destination (h - 1 - y, x), so a
// destination pixel (X, Y) came from source (Y, W - 1 - X) where W is the
// DESTINATION width. Applying that inverse once per rotation walks the
// reported pixel back to the original benchmark coordinates.
function mapResultPixelBackToOriginal(
  rotations: number,
  pixel: { x: number; y: number },
  resultDimensions: PixelDimensions,
): { x: number; y: number } {
  let coordinates = { x: pixel.x, y: pixel.y };
  let dimensions = resultDimensions;
  for (let step = 0; step < rotations; step += 1) {
    coordinates = { x: coordinates.y, y: dimensions.width - 1 - coordinates.x };
    dimensions = { width: dimensions.height, height: dimensions.width };
  }
  return coordinates;
}
