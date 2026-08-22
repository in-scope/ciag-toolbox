// CT-210: bridges the asynchronous scripting worker to the synchronous action
// pipeline for band selection. A custom formula or imported tool returns a full
// H x W band, which cannot ride through ParameterValuesById (primitives only) or
// the History inline text. The editor remembers the computed band here under a
// short token and stores that token in rendering state; transformSource resolves
// the token back to the band at apply time. This mirrors reference-raster-store.

export interface RememberedBandSelectionResult {
  readonly values: Float32Array;
  readonly width: number;
  readonly height: number;
}

let nextResultId = 0;
const resultsByToken = new Map<string, RememberedBandSelectionResult>();

export function rememberBandSelectionResult(result: RememberedBandSelectionResult): string {
  const token = `band-selection-${nextResultId}`;
  nextResultId += 1;
  resultsByToken.set(token, result);
  return token;
}

export function readRememberedBandSelectionResultOrNull(
  token: string,
): RememberedBandSelectionResult | null {
  return resultsByToken.get(token) ?? null;
}

export function forgetAllBandSelectionResults(): void {
  resultsByToken.clear();
}

// CT-290: an applied custom band aliases its remembered Float32Array into the
// result panel's raster, so the buffer-release flush must treat remembered
// results as live or a replaced result panel would detach the stored band.
export function listRememberedBandSelectionResultBuffers(): ArrayBufferLike[] {
  return [...resultsByToken.values()].map((result) => result.values.buffer);
}
