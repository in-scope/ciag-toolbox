import type { RasterImage } from "@/lib/image/raster-image";

// CT-111: a flat-field reference can come from a file on disk (token = file path)
// OR from an already-loaded panel/stack (token = a "panel::" marker carrying a
// human label). The reference-raster store is keyed by token, so loaded-panel
// tokens must be unique; embedding the panel number keeps them so. These pure
// helpers centralize how a token is displayed and how loaded-panel candidates
// are built, so both the picker UI and the audit-trail label agree.

const LOADED_PANEL_REFERENCE_TOKEN_PREFIX = "panel::";

export interface LoadedPanelReferenceEntry {
  readonly viewportNumber: number;
  readonly fileName: string;
  readonly raster: RasterImage;
}

export interface ReferencePickerOption {
  readonly token: string;
  readonly label: string;
}

export interface LoadedReferenceCandidate extends ReferencePickerOption {
  readonly raster: RasterImage;
}

export function buildLoadedPanelReferenceToken(viewportNumber: number, fileName: string): string {
  return `${LOADED_PANEL_REFERENCE_TOKEN_PREFIX}${describeLoadedPanelReference(viewportNumber, fileName)}`;
}

export function isLoadedPanelReferenceToken(token: string): boolean {
  return token.startsWith(LOADED_PANEL_REFERENCE_TOKEN_PREFIX);
}

export function readReferenceTokenDisplayName(token: string): string {
  if (isLoadedPanelReferenceToken(token)) {
    return token.slice(LOADED_PANEL_REFERENCE_TOKEN_PREFIX.length);
  }
  return readBaseFileNameFromPathToken(token);
}

export function buildLoadedReferenceCandidates(
  entries: ReadonlyArray<LoadedPanelReferenceEntry>,
): LoadedReferenceCandidate[] {
  return entries.map((entry) => ({
    token: buildLoadedPanelReferenceToken(entry.viewportNumber, entry.fileName),
    label: describeLoadedPanelReference(entry.viewportNumber, entry.fileName),
    raster: entry.raster,
  }));
}

function describeLoadedPanelReference(viewportNumber: number, fileName: string): string {
  return `Panel ${viewportNumber} (${fileName})`;
}

function readBaseFileNameFromPathToken(token: string): string {
  const segments = token.split(/[\\/]/);
  return segments[segments.length - 1] ?? token;
}
