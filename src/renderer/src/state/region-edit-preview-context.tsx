import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

import type { ViewportRoi } from "@/lib/image/viewport-roi";

/**
 * CT-275: while the committed region box is being dragged or resized, the
 * in-progress geometry is published here so read-only coordinate displays (the
 * right-panel Region section) can track the box LIVE without committing to
 * rendering state on every pointer move (a commit recomputes the ROI mean
 * spectrum, far too heavy per-move at stack scale). The snapshot names which
 * box is being edited so the Region section only mirrors the inspection ROI.
 */
export type RegionEditTarget = "inspection-roi" | "operation-region";

export interface RegionEditPreviewSnapshot {
  readonly viewportNumber: number;
  readonly target: RegionEditTarget;
  readonly roi: ViewportRoi;
}

export type RegionEditPreviewPublisher = (snapshot: RegionEditPreviewSnapshot | null) => void;

const RegionEditPreviewSnapshotContext = createContext<RegionEditPreviewSnapshot | null>(null);
const RegionEditPreviewPublisherContext = createContext<RegionEditPreviewPublisher | null>(null);

interface RegionEditPreviewProviderProps {
  readonly children: ReactNode;
}

export function RegionEditPreviewProvider({
  children,
}: RegionEditPreviewProviderProps): JSX.Element {
  const [snapshot, setSnapshot] = useState<RegionEditPreviewSnapshot | null>(null);
  const publish = useCallback<RegionEditPreviewPublisher>((next) => setSnapshot(next), []);
  return (
    <RegionEditPreviewPublisherContext.Provider value={publish}>
      <RegionEditPreviewSnapshotContext.Provider value={snapshot}>
        {children}
      </RegionEditPreviewSnapshotContext.Provider>
    </RegionEditPreviewPublisherContext.Provider>
  );
}

export function useCurrentRegionEditPreview(): RegionEditPreviewSnapshot | null {
  return useContext(RegionEditPreviewSnapshotContext);
}

export function useRegionEditPreviewPublisher(): RegionEditPreviewPublisher {
  const publisher = useContext(RegionEditPreviewPublisherContext);
  if (!publisher) {
    throw new Error("useRegionEditPreviewPublisher must be used inside a RegionEditPreviewProvider");
  }
  return publisher;
}
