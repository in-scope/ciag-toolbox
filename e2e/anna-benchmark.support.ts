// The Anna benchmark (Stage 5 fixes PRD): a synthetic 1000 x 2000 x 49-band
// uint16 stack (~196 MB), the reference scale for the CT-267/CT-268/CT-269/
// CT-270 performance stories. It is GENERATED, never committed: the multi-page
// TIFF is written on demand into the gitignored .scale-audit/ directory with
// the CT-230 streaming fixture writers, so any perf spec can call
// ensureAnnaBenchmarkFixtureExists() in beforeEach and run without a manual
// generation step. Pixel values follow the scale10 oracle formula
// value(band, x, y) = (band + 1) * 600 + (x % 100) + (y % 100), which makes
// every reported pixel exactly checkable after a coordinate remap.
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ScaleFixtureCaptureSpec } from "../scripts/scale-fixture-writers.mjs";
import { writeMultiPageUint16Tiff } from "../scripts/scale-fixture-writers.mjs";
import type { PixelDimensions } from "./support/image-pixel-canvas-mapping";

const CURRENT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const GENERATED_FIXTURE_DIRECTORY = resolve(CURRENT_DIRECTORY, "..", ".scale-audit");

export const ANNA_BENCHMARK_DIMENSIONS: PixelDimensions = { width: 1_000, height: 2_000 };
export const ANNA_BENCHMARK_BAND_COUNT = 49;
export const ANNA_BENCHMARK_TIFF_PATH = join(GENERATED_FIXTURE_DIRECTORY, "anna-benchmark.tif");

const ANNA_BENCHMARK_SPEC: ScaleFixtureCaptureSpec = {
  width: ANNA_BENCHMARK_DIMENSIONS.width,
  height: ANNA_BENCHMARK_DIMENSIONS.height,
  bandCount: ANNA_BENCHMARK_BAND_COUNT,
  bandBase: (bandIndex) => (bandIndex + 1) * 600,
};

// value(band, x, y) with band ZERO-based; max value 49*600 + 99 + 99 = 29598,
// safely inside uint16.
export function annaBenchmarkValue(bandIndexZeroBased: number, x: number, y: number): number {
  return ANNA_BENCHMARK_SPEC.bandBase(bandIndexZeroBased) + (x % 100) + (y % 100);
}

export function ensureAnnaBenchmarkFixtureExists(): void {
  if (annaBenchmarkFixtureIsComplete()) return;
  mkdirSync(GENERATED_FIXTURE_DIRECTORY, { recursive: true });
  writeMultiPageUint16Tiff(ANNA_BENCHMARK_TIFF_PATH, ANNA_BENCHMARK_SPEC);
}

// A crashed earlier run can leave a truncated file behind; the exact expected
// byte count (streaming-writer layout: 8-byte header, then per band one
// 126-byte IFD followed by its uncompressed uint16 strip) detects that and
// triggers a regeneration.
function annaBenchmarkFixtureIsComplete(): boolean {
  if (!existsSync(ANNA_BENCHMARK_TIFF_PATH)) return false;
  return statSync(ANNA_BENCHMARK_TIFF_PATH).size === expectedAnnaBenchmarkTiffByteCount();
}

function expectedAnnaBenchmarkTiffByteCount(): number {
  const tiffHeaderBytes = 8;
  const perBandIfdBytes = 126;
  const perBandStripBytes = ANNA_BENCHMARK_SPEC.width * ANNA_BENCHMARK_SPEC.height * 2;
  return tiffHeaderBytes + ANNA_BENCHMARK_BAND_COUNT * (perBandIfdBytes + perBandStripBytes);
}
