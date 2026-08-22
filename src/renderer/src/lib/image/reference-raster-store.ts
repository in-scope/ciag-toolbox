import type { RasterImage } from "@/lib/image/raster-image";
import { isLoadedPanelReferenceToken } from "@/lib/image/reference-token";

// CT-078: bridges asynchronous reference-cube loading to the synchronous action
// pipeline. Flat-field correction needs light/dark reference cubes loaded from
// disk, but ParameterValuesById holds only primitives and transformSource runs
// synchronously. The parameter UI loads a reference cube when picked and remembers
// it here under a token (its file path); transformSource resolves the token back
// to the raster at apply time.

const referenceRastersByToken = new Map<string, RasterImage>();

export function rememberReferenceRaster(token: string, raster: RasterImage): void {
  referenceRastersByToken.set(token, raster);
}

export interface PanelReferenceCandidate {
  readonly token: string;
  readonly raster: RasterImage;
}

// CT-239: the loaded-panel candidates must be SYNCED, not accumulated. The old
// remember-only loop pinned every raster that had ever been in a panel, so
// closing a panel never released its cube and the renderer's hard ~17 GB
// ArrayBuffer pool filled up after one full-scale apply-and-close. Stale
// panel:: entries are evicted; file-path tokens (picked reference files) are
// deliberately kept, since they are panel-independent.
export function replaceRememberedPanelReferenceRasters(
  candidates: ReadonlyArray<PanelReferenceCandidate>,
): void {
  forgetStalePanelReferenceRasters(new Set(candidates.map((candidate) => candidate.token)));
  for (const candidate of candidates) {
    referenceRastersByToken.set(candidate.token, candidate.raster);
  }
}

function forgetStalePanelReferenceRasters(currentPanelTokens: ReadonlySet<string>): void {
  for (const token of [...referenceRastersByToken.keys()]) {
    if (isLoadedPanelReferenceToken(token) && !currentPanelTokens.has(token)) {
      referenceRastersByToken.delete(token);
    }
  }
}

export function readRememberedReferenceRasterOrNull(token: string): RasterImage | null {
  return referenceRastersByToken.get(token) ?? null;
}

// CT-290: the buffer-release flush must treat every remembered raster (panel
// entries AND panel-independent file-path entries) as live so a replaced or
// closed panel that shares bands with one never gets those buffers detached.
export function listRememberedReferenceRasters(): RasterImage[] {
  return [...referenceRastersByToken.values()];
}

export function forgetAllReferenceRasters(): void {
  referenceRastersByToken.clear();
}
