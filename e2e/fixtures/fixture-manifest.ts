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

const FIXTURES_DIRECTORY = dirname(fileURLToPath(import.meta.url));

export const lowContrastGrayPng = manifestJson.lowContrastGrayPng as SingleFileFixture;
export const bimodalGrayPng = manifestJson.bimodalGrayPng as BimodalGrayFixture;
export const noisyGrayPng = manifestJson.noisyGrayPng as NoisyGrayFixture;
export const rgbPng = manifestJson.rgbPng as SingleFileFixture;
export const multiBandTiff = manifestJson.multiBandTiff as SingleFileFixture;
export const flatFieldReferenceTiff = manifestJson.flatFieldReferenceTiff as SingleFileFixture;
export const enviStack = manifestJson.enviStack as EnviFixture;
export const enviFloatStack = manifestJson.enviFloatStack as EnviFixture;

export function fixturePath(fileName: string): string {
  return join(FIXTURES_DIRECTORY, fileName);
}
