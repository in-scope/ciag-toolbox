import { Loader2 } from "lucide-react";

import {
  useMostRecentAppBusyEntry,
  useMostRecentViewportBusyEntry,
  useShouldRenderBusyEntryAfterDelay,
  type BusyEntry,
} from "@/state/busy-state-context";

export function AppBusyModal(): JSX.Element | null {
  const entry = useMostRecentAppBusyEntry();
  const shouldRender = useShouldRenderBusyEntryAfterDelay(entry);
  if (!shouldRender || !entry) return null;
  return (
    <div
      role="alertdialog"
      aria-live="polite"
      aria-label={entry.label}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    >
      <BusyIndicatorCard entry={entry} />
    </div>
  );
}

interface ViewportBusyOverlayProps {
  viewportIndex: number;
}

export function ViewportBusyOverlay(props: ViewportBusyOverlayProps): JSX.Element | null {
  const entry = useMostRecentViewportBusyEntry(props.viewportIndex);
  const shouldRender = useShouldRenderBusyEntryAfterDelay(entry);
  if (!shouldRender || !entry) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={entry.label}
      className="absolute inset-0 z-10 flex items-center justify-center bg-card/80 backdrop-blur-[1px]"
    >
      <BusyIndicatorCard entry={entry} />
    </div>
  );
}

function BusyIndicatorCard({ entry }: { entry: BusyEntry }): JSX.Element {
  return (
    <div className="flex min-w-[240px] max-w-sm flex-col items-center gap-3 rounded-md border bg-card p-6 shadow-lg">
      <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
      <p className="text-center text-sm text-foreground">{entry.label}</p>
      {entry.progress !== null ? <BusyProgressBar progress={entry.progress} /> : null}
    </div>
  );
}

function BusyProgressBar({ progress }: { progress: number }): JSX.Element {
  const clamped = clampProgressToZeroOneRange(progress);
  const widthPercent = `${(clamped * 100).toFixed(1)}%`;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={clamped}
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className="h-full bg-primary transition-[width] duration-150"
        style={{ width: widthPercent }}
      />
    </div>
  );
}

function clampProgressToZeroOneRange(progress: number): number {
  if (Number.isNaN(progress) || progress < 0) return 0;
  if (progress > 1) return 1;
  return progress;
}
