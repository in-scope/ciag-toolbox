// CT-273: file naming for the PNG stack folder export. Band files are named
// <sourceBaseName>_band_001.png, zero-padded to the band-count width with a
// three-digit floor so a typical stack reads uniformly (band 7 of 49 ->
// _band_007, band 7 of 5000 -> _band_0007).

const MINIMUM_BAND_NUMBER_PAD_WIDTH = 3;

// eslint-disable-next-line no-control-regex -- control characters are exactly what a file name must not contain
const CHARACTERS_INVALID_IN_FILE_NAMES = /[\\/:*?"<>|\u0000-\u001f]/g;

export function sanitizePngStackBaseName(originalFileName: string): string {
  const stem = stripExtensionFromFileName(originalFileName);
  const cleaned = stem
    .replace(CHARACTERS_INVALID_IN_FILE_NAMES, "-")
    .replace(/[. ]+$/, "")
    .trim();
  return cleaned.length > 0 ? cleaned : "stack";
}

export function buildPngStackBandFileName(
  baseName: string,
  bandNumber: number,
  bandCount: number,
): string {
  const width = Math.max(MINIMUM_BAND_NUMBER_PAD_WIDTH, String(bandCount).length);
  return `${baseName}_band_${String(bandNumber).padStart(width, "0")}.png`;
}

export function listPngStackBandFileNames(
  originalFileName: string,
  bandCount: number,
): ReadonlyArray<string> {
  const baseName = sanitizePngStackBaseName(originalFileName);
  return Array.from({ length: bandCount }, (_, bandIndex) =>
    buildPngStackBandFileName(baseName, bandIndex + 1, bandCount),
  );
}

function stripExtensionFromFileName(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0) return fileName;
  return fileName.slice(0, lastDot);
}
