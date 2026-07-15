import {
  runOverSampleRangesYielding,
  samplesPerChunkForPerBandSweep,
} from "@/lib/image/dimension-reduction/band-statistics";
import type { CubeSampleMatrix } from "@/lib/image/dimension-reduction/cube-samples";
import type { ComponentProjection } from "@/lib/image/dimension-reduction/transform-output";
import { allocateFloat32ArrayOrThrow } from "@/lib/image/raster-allocation";
import {
  reportMultiUnitWorkStarting,
  reportProgressFractionAndYield,
  type UnitProgressCallback,
} from "@/lib/image/unit-progress";

// CT-183: PCA and MNF both turn a fitted set of component vectors into a
// projection the same way: mean-centre every pixel with the fit means and dot it
// with each kept component vector. Only the source of the vectors differs (PCA
// eigenvectors vs MNF noise-whitened vectors), so the projection itself lives
// here, shared by both transforms. CT-240: each component projects into float32
// ON THE FLY from the original band arrays (the sample matrix aliases them) -
// no intermediate cube-sized buffer exists, and the per-component output routes
// through the mapped allocator.

export function projectMeanCentredSamplesOntoComponentVectors(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  componentVectors: ReadonlyArray<ReadonlyArray<number>>,
  keptCount: number,
): ComponentProjection {
  return Array.from({ length: keptCount }, (_unused, component) =>
    projectEverySampleOntoComponentVector(samples, means, componentVectors[component]!),
  );
}

// CT-223 / CT-240: the async twin. Identical per-sample math and accumulation
// order; each component owns an equal window of the bar and its sample sweep is
// chunked with paint yields so a single 50-megapixel component never blocks the
// renderer past the UI-gap threshold.
export async function projectMeanCentredSamplesOntoComponentVectorsReportingProgress(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  componentVectors: ReadonlyArray<ReadonlyArray<number>>,
  keptCount: number,
  onProgress?: UnitProgressCallback,
): Promise<ComponentProjection> {
  reportMultiUnitWorkStarting(onProgress, keptCount);
  const projected: Float32Array[] = [];
  for (let component = 0; component < keptCount; component += 1) {
    projected.push(await projectComponentInSampleChunks(samples, means, componentVectors[component]!));
    await reportProgressFractionAndYield(onProgress, (component + 1) / keptCount);
  }
  return projected;
}

async function projectComponentInSampleChunks(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  componentVector: ReadonlyArray<number>,
): Promise<Float32Array> {
  const projected = allocateFloat32ArrayOrThrow(samples.sampleCount);
  await runOverSampleRangesYielding(
    samples.sampleCount,
    samplesPerChunkForPerBandSweep(samples.bandCount),
    (start, end) => fillProjectedSampleRange(samples, means, componentVector, projected, start, end),
  );
  return projected;
}

function projectEverySampleOntoComponentVector(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  componentVector: ReadonlyArray<number>,
): Float32Array {
  const projected = allocateFloat32ArrayOrThrow(samples.sampleCount);
  fillProjectedSampleRange(samples, means, componentVector, projected, 0, samples.sampleCount);
  return projected;
}

function fillProjectedSampleRange(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  componentVector: ReadonlyArray<number>,
  projected: Float32Array,
  startSample: number,
  endSample: number,
): void {
  for (let pixel = startSample; pixel < endSample; pixel += 1) {
    projected[pixel] = finiteOrZero(
      projectSingleSampleOntoComponentVector(samples, means, componentVector, pixel),
    );
  }
}

function projectSingleSampleOntoComponentVector(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  componentVector: ReadonlyArray<number>,
  pixel: number,
): number {
  let value = 0;
  for (let band = 0; band < samples.bandCount; band += 1) {
    value += componentVector[band]! * (samples.bandValues[band]![pixel]! - means[band]!);
  }
  return value;
}

// A component band that is not finite (e.g. a non-finite source value or fit
// vector reaching the projection) would render as a white/blank panel through the
// float display texture (CT-195). Every dimension-reduction transform routes its
// projection through here, so guarding it once keeps PCA/MNF/ICA output finite.
function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
