import {
  type RasterImage,
  type RasterTypedArray,
} from "@/lib/image/raster-image";

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

interface DestinationPixel {
  readonly dx: number;
  readonly dy: number;
}

interface GeometricTransformDefinition {
  readonly swapsDimensions: boolean;
  readonly mapSourcePixelToDestination: (
    x: number,
    y: number,
    width: number,
    height: number,
  ) => DestinationPixel;
}

const GEOMETRIC_TRANSFORM_DEFINITIONS: Record<GeometricTransform, GeometricTransformDefinition> = {
  "rotate-90-cw": { swapsDimensions: true, mapSourcePixelToDestination: (x, y, _w, h) => ({ dx: h - 1 - y, dy: x }) },
  "rotate-180": { swapsDimensions: false, mapSourcePixelToDestination: (x, y, w, h) => ({ dx: w - 1 - x, dy: h - 1 - y }) },
  "rotate-270-cw": { swapsDimensions: true, mapSourcePixelToDestination: (x, y, w, _h) => ({ dx: y, dy: w - 1 - x }) },
  "flip-horizontal": { swapsDimensions: false, mapSourcePixelToDestination: (x, y, w, _h) => ({ dx: w - 1 - x, dy: y }) },
  "flip-vertical": { swapsDimensions: false, mapSourcePixelToDestination: (x, y, _w, h) => ({ dx: x, dy: h - 1 - y }) },
};

export function applyGeometricTransformToRasterImage(
  raster: RasterImage,
  transform: GeometricTransform,
): RasterImage {
  const definition = GEOMETRIC_TRANSFORM_DEFINITIONS[transform];
  const destinationWidth = definition.swapsDimensions ? raster.height : raster.width;
  const destinationHeight = definition.swapsDimensions ? raster.width : raster.height;
  const bandPixels = raster.bandPixels.map((band) =>
    remapBandToDestination(band, raster.width, raster.height, destinationWidth, definition),
  );
  return { ...raster, bandPixels, width: destinationWidth, height: destinationHeight };
}

function remapBandToDestination(
  band: RasterTypedArray,
  width: number,
  height: number,
  destinationWidth: number,
  definition: GeometricTransformDefinition,
): RasterTypedArray {
  const destination = makeEmptyBandMatchingType(band, band.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const { dx, dy } = definition.mapSourcePixelToDestination(x, y, width, height);
      destination[dy * destinationWidth + dx] = band[y * width + x] ?? 0;
    }
  }
  return destination;
}

function makeEmptyBandMatchingType(band: RasterTypedArray, length: number): RasterTypedArray {
  const Constructor = band.constructor as new (length: number) => RasterTypedArray;
  return new Constructor(length);
}
