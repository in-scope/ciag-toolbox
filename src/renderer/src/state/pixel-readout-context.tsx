import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { ViewportPixelReadoutBands } from "@/lib/image/compute-pixel-readout";

export interface ViewportPixelReadoutSnapshot {
  readonly viewportNumber: number;
  readonly imagePixelX: number;
  readonly imagePixelY: number;
  readonly selectedBandIndex: number;
  readonly bands: ViewportPixelReadoutBands | null;
  readonly bandCount: number;
}

export type PixelReadoutPublisher = (snapshot: ViewportPixelReadoutSnapshot | null) => void;

const PixelReadoutSnapshotContext = createContext<ViewportPixelReadoutSnapshot | null>(null);
const PixelReadoutPublisherContext = createContext<PixelReadoutPublisher | null>(null);

interface PixelReadoutProviderProps {
  children: ReactNode;
}

export function PixelReadoutProvider({ children }: PixelReadoutProviderProps): JSX.Element {
  const [snapshot, setSnapshot] = useState<ViewportPixelReadoutSnapshot | null>(null);
  const publishReadoutSnapshot = useCallback<PixelReadoutPublisher>(
    (next) => setSnapshot(next),
    [],
  );
  const memoizedPublisher = useMemo(() => publishReadoutSnapshot, [publishReadoutSnapshot]);
  return (
    <PixelReadoutPublisherContext.Provider value={memoizedPublisher}>
      <PixelReadoutSnapshotContext.Provider value={snapshot}>
        {children}
      </PixelReadoutSnapshotContext.Provider>
    </PixelReadoutPublisherContext.Provider>
  );
}

export function useCurrentPixelReadoutSnapshot(): ViewportPixelReadoutSnapshot | null {
  return useContext(PixelReadoutSnapshotContext);
}

export function usePixelReadoutPublisher(): PixelReadoutPublisher {
  const publisher = useContext(PixelReadoutPublisherContext);
  if (!publisher) {
    throw new Error("usePixelReadoutPublisher must be used inside a PixelReadoutProvider");
  }
  return publisher;
}
