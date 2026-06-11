export type RightPanelSectionKey =
  | "metadata"
  | "subset-bands"
  | "histogram"
  | "spectra"
  | "region"
  | "history";

export interface RightPanelSectionVisibility {
  readonly hasActiveSource: boolean;
  readonly showSubsetBandsEditor: boolean;
  readonly showHistogram: boolean;
  readonly showSpectra: boolean;
  readonly showRegion: boolean;
  readonly showHistory: boolean;
}

export function listVisibleRightPanelSectionKeys(
  visibility: RightPanelSectionVisibility,
): RightPanelSectionKey[] {
  const keys: RightPanelSectionKey[] = [];
  if (visibility.hasActiveSource) keys.push("metadata");
  if (visibility.showSubsetBandsEditor) keys.push("subset-bands");
  if (visibility.showHistogram) keys.push("histogram");
  if (visibility.showSpectra) keys.push("spectra");
  if (visibility.showRegion) keys.push("region");
  if (visibility.showHistory) keys.push("history");
  return keys;
}
