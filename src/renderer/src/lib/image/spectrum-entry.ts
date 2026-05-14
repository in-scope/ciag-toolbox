export const MAX_PINNED_SPECTRA_PER_VIEWPORT = 5;

export interface PinnedPixelSpectrum {
  readonly kind: "pixel";
  readonly id: string;
  readonly imagePixelX: number;
  readonly imagePixelY: number;
  readonly bandValues: ReadonlyArray<number>;
}

export interface PinnedRoiMeanSpectrum {
  readonly kind: "roi-mean";
  readonly id: string;
  readonly samplePixelCount: number;
  readonly bandMeans: ReadonlyArray<number>;
  readonly bandStandardDeviations: ReadonlyArray<number>;
}

export type PinnedSpectrum = PinnedPixelSpectrum | PinnedRoiMeanSpectrum;

export type PinnedSpectraList = ReadonlyArray<PinnedSpectrum>;

export const EMPTY_PINNED_SPECTRA: PinnedSpectraList = Object.freeze([]);

export function appendPinnedSpectrumWithCapLimit(
  spectra: PinnedSpectraList,
  next: PinnedSpectrum,
): PinnedSpectraList {
  const remainder = spectra.slice(-(MAX_PINNED_SPECTRA_PER_VIEWPORT - 1));
  return Object.freeze([...remainder, next]);
}

export function removePinnedSpectrumById(
  spectra: PinnedSpectraList,
  spectrumId: string,
): PinnedSpectraList {
  const next = spectra.filter((entry) => entry.id !== spectrumId);
  return Object.freeze(next);
}

export function buildPinnedSpectrumIdFromTimestamp(
  timestampMs: number,
  randomSeed: number,
): string {
  return `${timestampMs.toString(36)}-${Math.floor(randomSeed * 1e6).toString(36)}`;
}
