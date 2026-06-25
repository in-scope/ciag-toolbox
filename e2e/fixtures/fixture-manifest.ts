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

const FIXTURES_DIRECTORY = dirname(fileURLToPath(import.meta.url));

export const lowContrastGrayPng = manifestJson.lowContrastGrayPng as SingleFileFixture;
export const rgbPng = manifestJson.rgbPng as SingleFileFixture;
export const multiBandTiff = manifestJson.multiBandTiff as SingleFileFixture;
export const flatFieldReferenceTiff = manifestJson.flatFieldReferenceTiff as SingleFileFixture;
export const enviStack = manifestJson.enviStack as EnviFixture;
export const enviFloatStack = manifestJson.enviFloatStack as EnviFixture;

export function fixturePath(fileName: string): string {
  return join(FIXTURES_DIRECTORY, fileName);
}
