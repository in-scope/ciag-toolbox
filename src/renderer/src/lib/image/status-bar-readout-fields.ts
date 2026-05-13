import { formatSinglePixelReadoutValue } from "@/lib/image/compute-pixel-readout";
import type { ViewportPixelReadoutSnapshot } from "@/state/pixel-readout-context";

export interface StatusBarReadoutFields {
  readonly viewportNumber: string;
  readonly imagePixelX: string;
  readonly imagePixelY: string;
  readonly activeBandLabel: string | null;
  readonly activeBandValue: string;
}

export const STATUS_BAR_VALUE_PLACEHOLDER = "-";

export function buildStatusBarReadoutFieldsFromSnapshot(
  snapshot: ViewportPixelReadoutSnapshot,
): StatusBarReadoutFields {
  return {
    viewportNumber: String(snapshot.viewportNumber),
    imagePixelX: String(snapshot.imagePixelX),
    imagePixelY: String(snapshot.imagePixelY),
    activeBandLabel: readActiveBandLabelFromSnapshotOrNull(snapshot),
    activeBandValue: formatActiveBandValueFromSnapshot(snapshot),
  };
}

export function readActiveBandLabelFromSnapshotOrNull(
  snapshot: ViewportPixelReadoutSnapshot,
): string | null {
  const labels = snapshot.bands?.labels;
  if (!labels || labels.length === 0) return null;
  return labels[snapshot.selectedBandIndex] ?? null;
}

export function formatActiveBandValueFromSnapshot(
  snapshot: ViewportPixelReadoutSnapshot,
): string {
  if (!snapshot.bands) return STATUS_BAR_VALUE_PLACEHOLDER;
  const value = snapshot.bands.values[snapshot.selectedBandIndex];
  if (value === undefined) return STATUS_BAR_VALUE_PLACEHOLDER;
  return formatSinglePixelReadoutValue(value, snapshot.bands.sampleFormat);
}
