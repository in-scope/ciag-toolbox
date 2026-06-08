import { useEffect, useRef, useState } from "react";

import {
  createBandSelectionDebouncer,
  windowDebounceTimerControls,
  type BandSelectionDebouncer,
} from "@/lib/image/band-navigation-debounce";

export const BAND_SELECTION_DEBOUNCE_MS = 120;

export interface DebouncedBandSelection {
  displayedBandIndex: number;
  requestBandSelectionDebounced: (bandIndex: number) => void;
  commitBandSelectionImmediately: (bandIndex: number) => void;
}

export function useDebouncedBandSelection(
  activeBandIndex: number,
  onSelectBandIndex: (bandIndex: number) => void,
): DebouncedBandSelection {
  const [displayedBandIndex, setDisplayedBandIndex] = useState(activeBandIndex);
  useSyncDisplayedBandIndexWhenActiveChanges(activeBandIndex, setDisplayedBandIndex);
  const debouncer = useStableBandSelectionDebouncer(onSelectBandIndex);
  return {
    displayedBandIndex,
    requestBandSelectionDebounced: (bandIndex) =>
      requestDebouncedBandSelection(bandIndex, setDisplayedBandIndex, debouncer),
    commitBandSelectionImmediately: (bandIndex) =>
      commitBandSelectionNow(bandIndex, setDisplayedBandIndex, debouncer, onSelectBandIndex),
  };
}

function useSyncDisplayedBandIndexWhenActiveChanges(
  activeBandIndex: number,
  setDisplayedBandIndex: (bandIndex: number) => void,
): void {
  useEffect(() => {
    setDisplayedBandIndex(activeBandIndex);
  }, [activeBandIndex, setDisplayedBandIndex]);
}

function requestDebouncedBandSelection(
  bandIndex: number,
  setDisplayedBandIndex: (bandIndex: number) => void,
  debouncer: BandSelectionDebouncer,
): void {
  setDisplayedBandIndex(bandIndex);
  debouncer.requestBandSelection(bandIndex);
}

function commitBandSelectionNow(
  bandIndex: number,
  setDisplayedBandIndex: (bandIndex: number) => void,
  debouncer: BandSelectionDebouncer,
  onSelectBandIndex: (bandIndex: number) => void,
): void {
  debouncer.cancelPendingBandSelection();
  setDisplayedBandIndex(bandIndex);
  onSelectBandIndex(bandIndex);
}

function useStableBandSelectionDebouncer(
  onSelectBandIndex: (bandIndex: number) => void,
): BandSelectionDebouncer {
  const latestCallbackRef = useRef(onSelectBandIndex);
  latestCallbackRef.current = onSelectBandIndex;
  const debouncerRef = useRef<BandSelectionDebouncer | null>(null);
  if (debouncerRef.current === null) {
    debouncerRef.current = createBandSelectionDebouncer(
      (bandIndex) => latestCallbackRef.current(bandIndex),
      BAND_SELECTION_DEBOUNCE_MS,
      windowDebounceTimerControls,
    );
  }
  useCancelPendingBandSelectionOnUnmount(debouncerRef.current);
  return debouncerRef.current;
}

function useCancelPendingBandSelectionOnUnmount(debouncer: BandSelectionDebouncer): void {
  useEffect(() => () => debouncer.cancelPendingBandSelection(), [debouncer]);
}
