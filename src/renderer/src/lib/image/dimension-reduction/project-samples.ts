import type { CubeSampleMatrix } from "@/lib/image/dimension-reduction/cube-samples";
import type { ComponentProjection } from "@/lib/image/dimension-reduction/transform-output";

// CT-183: PCA and MNF both turn a fitted set of component vectors into a
// projection the same way: mean-centre every pixel with the fit means and dot it
// with each kept component vector. Only the source of the vectors differs (PCA
// eigenvectors vs MNF noise-whitened vectors), so the projection itself lives
// here, shared by both transforms.

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

function projectEverySampleOntoComponentVector(
  samples: CubeSampleMatrix,
  means: ReadonlyArray<number>,
  componentVector: ReadonlyArray<number>,
): Float32Array {
  const projected = new Float32Array(samples.sampleCount);
  for (let pixel = 0; pixel < samples.sampleCount; pixel += 1) {
    projected[pixel] = projectSingleSampleOntoComponentVector(samples, means, componentVector, pixel);
  }
  return projected;
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
