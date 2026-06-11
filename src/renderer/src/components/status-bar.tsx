import {
  buildStatusBarReadoutFieldsFromSnapshot,
  type StatusBarReadoutFields,
} from "@/lib/image/status-bar-readout-fields";
import { useCurrentPixelReadoutSnapshot } from "@/state/pixel-readout-context";

export function StatusBar(): JSX.Element {
  const snapshot = useCurrentPixelReadoutSnapshot();
  return (
    <div
      role="status"
      aria-label="Pixel readout"
      className="flex h-6 shrink-0 items-center gap-4 border-t bg-card px-3 text-[11px] text-muted-foreground"
    >
      {snapshot ? (
        <StatusBarReadoutRow fields={buildStatusBarReadoutFieldsFromSnapshot(snapshot)} />
      ) : null}
    </div>
  );
}

function StatusBarReadoutRow({ fields }: { fields: StatusBarReadoutFields }): JSX.Element {
  return (
    <>
      <StatusBarLabelValue label="Panel" value={fields.viewportNumber} />
      <StatusBarLabelValue label="X" value={fields.imagePixelX} />
      <StatusBarLabelValue label="Y" value={fields.imagePixelY} />
      {fields.activeBandLabel ? (
        <StatusBarLabelValue label="Band" value={fields.activeBandLabel} />
      ) : null}
      <StatusBarLabelValue label="Value" value={fields.activeBandValue} />
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
