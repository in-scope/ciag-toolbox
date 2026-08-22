import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import manifestJson from "./manifest.json" with { type: "json" };

export interface FixtureSamplePixel {
  readonly x: number;
  readonly y: number;
  readonly valuesPerBand: ReadonlyArray<number>;
}

export interface SingleFileFixture {
  readonly fileName: string;
  readonly width: number;
  readonly height: number;
  readonly bandCount: number;
  readonly dataType: string;
  readonly bandMeans?: ReadonlyArray<number>;
  readonly samplePixels: ReadonlyArray<FixtureSamplePixel>;
}

export interface EnviFixture {
  readonly headerFileName: string;
  readonly binaryFileName: string;
  readonly width: number;
  readonly height: number;
  readonly bandCount: number;
  readonly dataType: string;
  readonly wavelengths: ReadonlyArray<number>;
  readonly bandMeans: ReadonlyArray<number>;
  readonly samplePixels: ReadonlyArray<FixtureSamplePixel>;
}

// CT-201: a grayscale fixture whose values form two separated clusters with a
// known empty valley; the generator pins the expected Otsu cutoff.
export interface BimodalGrayFixture extends SingleFileFixture {
  readonly expectedOtsuCutoff: number;
}

// CT-204: a smooth grayscale fixture with fixed salt-and-pepper spikes; the
// generator pins each spike's noisy (pre) value, smooth base value, and
// radius-1 median-denoised (post) value.
export interface NoisyGraySpike {
  readonly x: number;
  readonly y: number;
  readonly noisyValue: number;
  readonly smoothValue: number;
  readonly medianDenoisedValue: number;
}

export interface NoisyGrayFixture extends SingleFileFixture {
  readonly spikes: ReadonlyArray<NoisyGraySpike>;
}

// CT-303: a mask fixture is an 8-bit grayscale PNG of CATEGORY INDEXES (0 =
// unlabeled) plus, when it has one, the JSON sidecar naming its categories.
export interface MaskFixtureCategory {
  readonly index: number;
  readonly name: string;
  readonly color: string;
}

export interface MaskFixture {
  readonly fileName: string;
  readonly sidecarFileName?: string;
  readonly width: number;
  readonly height: number;
  readonly name?: string;
  readonly opacity?: number;
  readonly categories?: ReadonlyArray<MaskFixtureCategory>;
  readonly values: ReadonlyArray<number>;
}

// CT-307: reference outputs pinned by the generate-fixtures.mjs reference
// runner, which executes the built-in algorithm scripts with the bundled
// Python runtime. The parity oracle for CT-308 through CT-313: app results
// must match within 1e-4 relative tolerance.
export interface BuiltinScriptReferenceBase {
  readonly script: string;
  readonly fixture: string;
  readonly maskFixture?: string;
  readonly params: Readonly<Record<string, number | boolean | null>>;
}

export interface BuiltinScriptValueReference extends BuiltinScriptReferenceBase {
  readonly value: number;
}

export interface BuiltinScriptCubeReference extends BuiltinScriptReferenceBase {
  readonly shape: ReadonlyArray<number>;
  readonly values: ReadonlyArray<number>;
}

export interface BuiltinScriptReferences {
  readonly ropSeed: number;
  readonly npc: BuiltinScriptValueReference;
  // CT-308: the same fixture scored with a coarse binning, where the two mask
  // classes share bins, so the pinned value is not the trivially separable 1.
  readonly npcCoarseBins: BuiltinScriptValueReference;
  readonly rop: BuiltinScriptCubeReference;
  readonly l2Minimization: BuiltinScriptCubeReference;
  readonly localPca: BuiltinScriptCubeReference;
  readonly localMnf: BuiltinScriptCubeReference;
}

const FIXTURES_DIRECTORY = dirname(fileURLToPath(import.meta.url));

// CT-272: written by generate-png16-fixture.mjs (sharp/libvips, an external
// reference encoder), NOT by generate-fixtures.mjs, so it is pinned here by
// hand instead of in manifest.json. value = 300 + (y*width + x) * 500; every
// pixel exceeds 255, so an 8-bit downscale cannot reproduce these readouts.
export const gradientGray16Png: SingleFileFixture = {
  fileName: "gradient-gray16.png",
  width: 6,
  height: 4,
  bandCount: 1,
  dataType: "uint16",
  samplePixels: [
    { x: 0, y: 0, valuesPerBand: [300] },
    { x: 3, y: 1, valuesPerBand: [4800] },
    { x: 5, y: 3, valuesPerBand: [11800] },
  ],
};

export const lowContrastGrayPng = manifestJson.lowContrastGrayPng as SingleFileFixture;
export const bimodalGrayPng = manifestJson.bimodalGrayPng as BimodalGrayFixture;
export const noisyGrayPng = manifestJson.noisyGrayPng as NoisyGrayFixture;
export const rgbPng = manifestJson.rgbPng as SingleFileFixture;
export const multiBandTiff = manifestJson.multiBandTiff as SingleFileFixture;
export const flatFieldReferenceTiff = manifestJson.flatFieldReferenceTiff as SingleFileFixture;
export const rgbaTiff = manifestJson.rgbaTiff as SingleFileFixture;
export const paletteColorTiff = manifestJson.paletteColorTiff as SingleFileFixture;
export const untaggedRgbTiff = manifestJson.untaggedRgbTiff as SingleFileFixture;
export const enviStack = manifestJson.enviStack as EnviFixture;
export const enviFloatStack = manifestJson.enviFloatStack as EnviFixture;
export const maskMultibandPng = manifestJson.maskMultibandPng as MaskFixture;
export const maskEightBySquarePng = manifestJson.maskEightBySquarePng as MaskFixture;
export const parityStackTiff = manifestJson.parityStackTiff as SingleFileFixture;
export const builtinScriptReferences =
  manifestJson.builtinScriptReferences as unknown as BuiltinScriptReferences;

export function fixturePath(fileName: string): string {
  return join(FIXTURES_DIRECTORY, fileName);
}
