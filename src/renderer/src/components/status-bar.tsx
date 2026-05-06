import { formatPixelReadoutValuesAsCommaSeparatedList } from "@/lib/image/compute-pixel-readout";
import {
  useCurrentPixelReadoutSnapshot,
  type ViewportPixelReadoutSnapshot,
} from "@/state/pixel-readout-context";

export function StatusBar(): JSX.Element {
  const snapshot = useCurrentPixelReadoutSnapshot();
  return (
    <div
      role="status"
      aria-label="Pixel readout"
      className="flex h-6 shrink-0 items-center gap-4 border-t bg-card px-3 text-[11px] text-muted-foreground"
    >
      {snapshot ? <StatusBarReadoutRow snapshot={snapshot} /> : null}
    </div>
  );
}

function StatusBarReadoutRow({
  snapshot,
}: {
  snapshot: ViewportPixelReadoutSnapshot;
}): JSX.Element {
  return (
    <>
      <StatusBarLabelValue label="Viewport" value={String(snapshot.viewportNumber)} />
      <StatusBarLabelValue label="X" value={String(snapshot.imagePixelX)} />
      <StatusBarLabelValue label="Y" value={String(snapshot.imagePixelY)} />
      <StatusBarSelectedBandLabel
        selectedBandIndex={snapshot.selectedBandIndex}
        bandCount={snapshot.bandCount}
      />
      <StatusBarValuesLabel snapshot={snapshot} />
    </>
  );
}

function StatusBarLabelValue({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <span className="flex items-center gap-1">
      <span>{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </span>
  );
}

function StatusBarSelectedBandLabel({
  selectedBandIndex,
  bandCount,
}: {
  selectedBandIndex: number;
  bandCount: number;
}): JSX.Element | null {
  if (bandCount <= 0) return null;
  const value = `${selectedBandIndex + 1} of ${bandCount}`;
  return <StatusBarLabelValue label="Band" value={value} />;
}

function StatusBarValuesLabel({
  snapshot,
}: {
  snapshot: ViewportPixelReadoutSnapshot;
}): JSX.Element {
  if (!snapshot.bands) {
    return <StatusBarLabelValue label="Values" value="-" />;
  }
  const formatted = formatPixelReadoutValuesAsCommaSeparatedList(
    snapshot.bands.values,
    snapshot.bands.sampleFormat,
  );
  return <StatusBarLabelValue label="Values" value={formatted} />;
}
