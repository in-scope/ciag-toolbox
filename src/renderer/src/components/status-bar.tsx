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
      <StatusBarLabelValue label="Panel" value={fields.viewportNumber} testId="pixel-readout-panel" />
      <StatusBarLabelValue label="X" value={fields.imagePixelX} testId="pixel-readout-x" />
      <StatusBarLabelValue label="Y" value={fields.imagePixelY} testId="pixel-readout-y" />
      {fields.activeBandLabel ? (
        <StatusBarLabelValue label="Band" value={fields.activeBandLabel} testId="pixel-readout-band" />
      ) : null}
      <StatusBarLabelValue label="Value" value={fields.activeBandValue} testId="pixel-readout-value" />
    </>
  );
}

function StatusBarLabelValue({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}): JSX.Element {
  return (
    <span className="flex items-center gap-1">
      <span>{label}</span>
      <span className="font-mono text-foreground" data-testid={testId}>
        {value}
      </span>
    </span>
  );
}
