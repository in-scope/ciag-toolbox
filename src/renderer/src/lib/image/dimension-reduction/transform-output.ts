import {
  makeFloat32RasterFromBands,
  type Float32RasterShape,
} from "@/lib/image/make-float-raster";
import type { RasterImage } from "@/lib/image/raster-image";

// CT-180: every dimension-reduction transform projects the cube onto its kept
// components and hands the resulting component bands here. A projection is just
// the kept component bands (one Float32Array per component, in component order);
// this builds the float32 RasterImage they become, reusing the CT-077 float
// helper so the kept-component count, dimensions, and float sampleFormat all
// come from one place and flow through tile rebuild, render, pixel readout and
// the ENVI float save path exactly like any other operation output.

export type ComponentProjection = ReadonlyArray<Float32Array>;

export interface ComponentStackSourceMeta {
  readonly width: number;
  readonly height: number;
  readonly componentLabelPrefix: string;
  // CT-180: a transform that reports a per-component strength (PCA variance %,
  // MNF noise fraction) supplies its own band labels here; otherwise the prefix
  // builds plain "<prefix> N" labels (the ICA case, which has no metric).
  readonly componentLabels?: ReadonlyArray<string>;
}

export function readComponentStackSourceMeta(
  source: RasterImage,
  componentLabelPrefix: string,
): ComponentStackSourceMeta {
  return { width: source.width, height: source.height, componentLabelPrefix };
}

export function makeComponentStackFromProjection(
  projection: ComponentProjection,
  sourceMeta: ComponentStackSourceMeta,
): RasterImage {
  return makeFloat32RasterFromBands(buildComponentStackShape(projection, sourceMeta), projection);
}

export function buildDefaultComponentLabels(componentCount: number, prefix: string): string[] {
  return Array.from({ length: componentCount }, (_, index) => `${prefix} ${index + 1}`);
}

function buildComponentStackShape(
  projection: ComponentProjection,
  sourceMeta: ComponentStackSourceMeta,
): Float32RasterShape {
  return {
    width: sourceMeta.width,
    height: sourceMeta.height,
    bandLabels: resolveComponentBandLabels(projection.length, sourceMeta),
  };
}

function resolveComponentBandLabels(
  componentCount: number,
  sourceMeta: ComponentStackSourceMeta,
): string[] {
  if (sourceMeta.componentLabels && sourceMeta.componentLabels.length === componentCount) {
    return [...sourceMeta.componentLabels];
  }
  return buildDefaultComponentLabels(componentCount, sourceMeta.componentLabelPrefix);
}
