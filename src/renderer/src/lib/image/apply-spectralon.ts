import { computeRoiMeanSpectrumOrNull } from "@/lib/image/compute-spectrum";
import {
  makeFloatRasterFromBandComputation,
  mapBandPixelsToFloat32,
} from "@/lib/image/make-float-raster";
import {
  getRasterBandLabelOrDefault,
  type RasterImage,
  type RasterTypedArray,
} from "@/lib/image/raster-image";
import type { ViewportRoi } from "@/lib/image/viewport-roi";

// CT-079: Spectralon reflectance calibration. Per band:
//   out = (raw - D) / (W - D) * reflectance
// W is the per-band mean over a bright Spectralon-target ROI, D the per-band mean
// over an optional dark-target ROI (zeros when omitted), and reflectance the known
// reflectance of the bright target. Output is a float32 raster (CT-077) so
// out-of-range true values survive while the display clips them.

export interface SpectralonCalibrationOptions {
  readonly brightRoi: ViewportRoi;
  readonly reflectance: number;
  readonly darkRoi?: ViewportRoi;
}

export function applySpectralonReflectanceCalibration(
  target: RasterImage,
  options: SpectralonCalibrationOptions,
): RasterImage {
  const brightMeans = computeBandMeansOverRoiOrThrow(target, options.brightRoi, "bright target");
  const darkMeans = resolveDarkBandMeansOrZeros(target, options.darkRoi);
  return makeFloatRasterFromBandComputation(target, (bandPixels, bandIndex) =>
    calibrateSingleBandToReflectance(
      { target, brightMeans, darkMeans, reflectance: options.reflectance },
      bandPixels,
      bandIndex,
    ),
  );
}

function computeBandMeansOverRoiOrThrow(
  raster: RasterImage,
  roi: ViewportRoi,
  roiName: string,
): ReadonlyArray<number> {
  const spectrum = computeRoiMeanSpectrumOrNull(raster, roi);
  if (!spectrum) {
    throw new Error(`The ${roiName} region is empty. Draw a region with at least one pixel.`);
  }
  return spectrum.bandMeans;
}

function resolveDarkBandMeansOrZeros(
  raster: RasterImage,
  darkRoi: ViewportRoi | undefined,
): ReadonlyArray<number> {
  if (!darkRoi) return new Array<number>(raster.bandCount).fill(0);
  return computeBandMeansOverRoiOrThrow(raster, darkRoi, "dark target");
}

interface BandCalibrationInputs {
  readonly target: RasterImage;
  readonly brightMeans: ReadonlyArray<number>;
  readonly darkMeans: ReadonlyArray<number>;
  readonly reflectance: number;
}

function calibrateSingleBandToReflectance(
  inputs: BandCalibrationInputs,
  bandPixels: RasterTypedArray,
  bandIndex: number,
): Float32Array {
  const darkMean = inputs.darkMeans[bandIndex] ?? 0;
  const denominator = (inputs.brightMeans[bandIndex] ?? 0) - darkMean;
  if (denominator === 0) throw new Error(buildZeroDenominatorMessage(inputs.target, bandIndex));
  const scale = inputs.reflectance / denominator;
  return mapBandPixelsToFloat32(bandPixels, (value) => (value - darkMean) * scale);
}

function buildZeroDenominatorMessage(target: RasterImage, bandIndex: number): string {
  return (
    `Spectralon calibration aborted: ${getRasterBandLabelOrDefault(target, bandIndex)} has ` +
    `equal bright and dark target means, which would divide by zero.`
  );
}
