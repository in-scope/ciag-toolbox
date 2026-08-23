import { allocateTypedArrayLikeBandOrThrow } from "@/lib/image/raster-allocation";
import {
  type RasterImage,
  type RasterTypedArray,
} from "@/lib/image/raster-image";
import {
  computeArrayReportingPerUnitProgress,
  type UnitProgressCallback,
} from "@/lib/image/unit-progress";

// CT-087: rotate (90/180/270 clockwise) and reflect (horizontal/vertical) the
// whole cube. Every band is remapped together with one shared coordinate
// mapping; 90 and 270 degree rotations swap width and height. Pixel values are
// untouched, only their positions move, so the data type is preserved.

export type GeometricTransform =
  | "rotate-90-cw"
  | "rotate-180"
  | "rotate-270-cw"
  | "flip-horizontal"
  | "flip-vertical";

// Rotations and reflections are distinct families: rotations turn the whole
// cube about its centre, reflections mirror it across an axis. They each get
// their own menu entry and side panel, so the catalog and the registered
// actions build their option lists from these two lists rather than the union.
export const ROTATION_TRANSFORMS: ReadonlyArray<GeometricTransform> = [
  "rotate-90-cw",
  "rotate-180",
  "rotate-270-cw",
];

export const REFLECTION_TRANSFORMS: ReadonlyArray<GeometricTransform> = [
  "flip-horizontal",
  "flip-vertical",
];

export const GEOMETRIC_TRANSFORMS: ReadonlyArray<GeometricTransform> = [
  ...ROTATION_TRANSFORMS,
  ...REFLECTION_TRANSFORMS,
];

export function isReflectionTransform(transform: GeometricTransform): boolean {
  return REFLECTION_TRANSFORMS.includes(transform);
}

export const GEOMETRIC_TRANSFORM_LABELS: Record<GeometricTransform, string> = {
  "rotate-90-cw": "Rotate 90 clockwise",
  "rotate-180": "Rotate 180",
  "rotate-270-cw": "Rotate 270 clockwise",
  "flip-horizontal": "Flip horizontal",
  "flip-vertical": "Flip vertical",
};

export function isGeometricTransform(value: unknown): value is GeometricTransform {
  return typeof value === "string" && GEOMETRIC_TRANSFORMS.includes(value as GeometricTransform);
}

// CT-267: each transform remaps a band with its own tight per-pixel loop
// (hoisted index math, no per-pixel closure or coordinate objects). The two
// dimension-swapping rotations walk the band in square tiles so the strided
// side of the transpose stays cache-resident at Anna-benchmark scale.
type TightBandRemapLoop = (
  source: RasterTypedArray,
  destination: RasterTypedArray,
  width: number,
  height: number,
) => void;

interface GeometricTransformDefinition {
  readonly swapsDimensions: boolean;
  readonly remapBandWithTightLoop: TightBandRemapLoop;
}

const GEOMETRIC_TRANSFORM_DEFINITIONS: Record<GeometricTransform, GeometricTransformDefinition> = {
  "rotate-90-cw": { swapsDimensions: true, remapBandWithTightLoop: remapBandRotating90Clockwise },
  "rotate-180": { swapsDimensions: false, remapBandWithTightLoop: remapBandRotating180 },
  "rotate-270-cw": { swapsDimensions: true, remapBandWithTightLoop: remapBandRotating270Clockwise },
  "flip-horizontal": { swapsDimensions: false, remapBandWithTightLoop: remapBandFlippingHorizontally },
  "flip-vertical": { swapsDimensions: false, remapBandWithTightLoop: remapBandFlippingVertically },
};

export function applyGeometricTransformToRasterImage(
  raster: RasterImage,
  transform: GeometricTransform,
): RasterImage {
  const definition = GEOMETRIC_TRANSFORM_DEFINITIONS[transform];
  const destinationWidth = definition.swapsDimensions ? raster.height : raster.width;
  const destinationHeight = definition.swapsDimensions ? raster.width : raster.height;
  const bandPixels = raster.bandPixels.map((band) =>
    remapBandToDestination(band, raster.width, raster.height, definition),
  );
  return { ...raster, bandPixels, width: destinationWidth, height: destinationHeight };
}

// CT-222: the async twin of applyGeometricTransformToRasterImage. Identical per-band
// math, one progress tick per band.
export async function applyGeometricTransformToRasterImageReportingProgress(
  raster: RasterImage,
  transform: GeometricTransform,
  onProgress?: UnitProgressCallback,
  abortSignal?: AbortSignal,
): Promise<RasterImage> {
  const definition = GEOMETRIC_TRANSFORM_DEFINITIONS[transform];
  const destinationWidth = definition.swapsDimensions ? raster.height : raster.width;
  const destinationHeight = definition.swapsDimensions ? raster.width : raster.height;
  const bandPixels = await computeArrayReportingPerUnitProgress(
    raster.bandPixels.length,
    (index) => remapBandToDestination(raster.bandPixels[index]!, raster.width, raster.height, definition),
    onProgress,
    abortSignal,
  );
  return { ...raster, bandPixels, width: destinationWidth, height: destinationHeight };
}

// A single width x height plane (a mask layer's values) remapped by the same
// tight loops as a raster band, so masks move exactly like the pixels they
// annotate. 90/270 rotations swap the returned width and height.
export interface TransformedPlane<T extends RasterTypedArray> {
  readonly values: T;
  readonly width: number;
  readonly height: number;
}

export function applyGeometricTransformToPlane<T extends RasterTypedArray>(
  values: T,
  width: number,
  height: number,
  transform: GeometricTransform,
): TransformedPlane<T> {
  const definition = GEOMETRIC_TRANSFORM_DEFINITIONS[transform];
  return {
    values: remapBandToDestination(values, width, height, definition) as T,
    width: definition.swapsDimensions ? height : width,
    height: definition.swapsDimensions ? width : height,
  };
}

function remapBandToDestination(
  band: RasterTypedArray,
  width: number,
  height: number,
  definition: GeometricTransformDefinition,
): RasterTypedArray {
  const destination = allocateTypedArrayLikeBandOrThrow(band, band.length);
  definition.remapBandWithTightLoop(band, destination, width, height);
  return destination;
}

// Square tiles keep both the contiguous and the strided side of a transpose
// inside the cache; 128 uint16/float32 rows of a tile stay well under L2.
const ROTATION_TILE_SIZE = 128;

type SpatialTileVisitor = (xStart: number, xEnd: number, yStart: number, yEnd: number) => void;

function visitBandInSquareTiles(width: number, height: number, visitTile: SpatialTileVisitor): void {
  for (let yStart = 0; yStart < height; yStart += ROTATION_TILE_SIZE) {
    const yEnd = Math.min(height, yStart + ROTATION_TILE_SIZE);
    for (let xStart = 0; xStart < width; xStart += ROTATION_TILE_SIZE) {
      visitTile(xStart, Math.min(width, xStart + ROTATION_TILE_SIZE), yStart, yEnd);
    }
  }
}

// Source (x, y) lands at destination (height - 1 - y, x) in a height-wide band.
function remapBandRotating90Clockwise(
  source: RasterTypedArray,
  destination: RasterTypedArray,
  width: number,
  height: number,
): void {
  visitBandInSquareTiles(width, height, (xStart, xEnd, yStart, yEnd) => {
    for (let y = yStart; y < yEnd; y += 1) {
      const sourceRowStart = y * width;
      const destinationColumn = height - 1 - y;
      for (let x = xStart; x < xEnd; x += 1) {
        destination[x * height + destinationColumn] = source[sourceRowStart + x]!;
      }
    }
  });
}

// Source (x, y) lands at destination (y, width - 1 - x) in a height-wide band.
function remapBandRotating270Clockwise(
  source: RasterTypedArray,
  destination: RasterTypedArray,
  width: number,
  height: number,
): void {
  visitBandInSquareTiles(width, height, (xStart, xEnd, yStart, yEnd) => {
    for (let y = yStart; y < yEnd; y += 1) {
      const sourceRowStart = y * width;
      for (let x = xStart; x < xEnd; x += 1) {
        destination[(width - 1 - x) * height + y] = source[sourceRowStart + x]!;
      }
    }
  });
}

function remapBandRotating180(
  source: RasterTypedArray,
  destination: RasterTypedArray,
  width: number,
  height: number,
): void {
  const lastIndex = width * height - 1;
  for (let index = 0; index <= lastIndex; index += 1) {
    destination[lastIndex - index] = source[index]!;
  }
}

function remapBandFlippingHorizontally(
  source: RasterTypedArray,
  destination: RasterTypedArray,
  width: number,
  height: number,
): void {
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * width;
    const rowLastIndex = rowStart + width - 1;
    for (let x = 0; x < width; x += 1) {
      destination[rowLastIndex - x] = source[rowStart + x]!;
    }
  }
}

function remapBandFlippingVertically(
  source: RasterTypedArray,
  destination: RasterTypedArray,
  width: number,
  height: number,
): void {
  for (let y = 0; y < height; y += 1) {
    const sourceRowStart = y * width;
    const mirroredRowStart = (height - 1 - y) * width;
    destination.set(source.subarray(sourceRowStart, sourceRowStart + width), mirroredRowStart);
  }
}
