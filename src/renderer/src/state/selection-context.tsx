import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
} from "react";

export interface ViewportSelectionClickModifiers {
  ctrlOrMeta: boolean;
  shift: boolean;
}

export interface ViewportSelectionState {
  selectedIndices: ReadonlySet<number>;
  selectedCount: number;
  isViewportSelected: (index: number) => boolean;
  selectViewportFromClick: (index: number, modifiers: ViewportSelectionClickModifiers) => void;
  clearSelection: () => void;
  pruneSelectionToCellCount: (cellCount: number) => void;
}

const ViewportSelectionContext = createContext<ViewportSelectionState | null>(null);

interface ViewportSelectionProviderProps {
  children: ReactNode;
}

export function ViewportSelectionProvider({
  children,
}: ViewportSelectionProviderProps): JSX.Element {
  const value = useViewportSelectionInternalState();
  return (
    <ViewportSelectionContext.Provider value={value}>{children}</ViewportSelectionContext.Provider>
  );
}

export function useViewportSelection(): ViewportSelectionState {
  const value = useContext(ViewportSelectionContext);
  if (!value) {
    throw new Error("useViewportSelection must be used inside a ViewportSelectionProvider");
  }
  return value;
}

const EMPTY_SELECTION: ReadonlySet<number> = new Set();

type SelectionAnchorRef = MutableRefObject<number | null>;
type SelectionSetter = Dispatch<SetStateAction<ReadonlySet<number>>>;

function useViewportSelectionInternalState(): ViewportSelectionState {
  const [selectedIndices, setSelectedIndices] = useState<ReadonlySet<number>>(EMPTY_SELECTION);
  const anchorRef = useRef<number | null>(null);
  const selectViewportFromClick = useSelectViewportFromClickCallback(anchorRef, setSelectedIndices);
  const clearSelection = useClearSelectionCallback(anchorRef, setSelectedIndices);
  const pruneSelectionToCellCount = usePruneSelectionToCellCountCallback(
    anchorRef,
    setSelectedIndices,
  );
  return useMemo(
    () =>
      buildSelectionState(
        selectedIndices,
        selectViewportFromClick,
        clearSelection,
        pruneSelectionToCellCount,
      ),
    [selectedIndices, selectViewportFromClick, clearSelection, pruneSelectionToCellCount],
  );
}

function buildSelectionState(
  selectedIndices: ReadonlySet<number>,
  selectViewportFromClick: ViewportSelectionState["selectViewportFromClick"],
  clearSelection: ViewportSelectionState["clearSelection"],
  pruneSelectionToCellCount: ViewportSelectionState["pruneSelectionToCellCount"],
): ViewportSelectionState {
  return {
    selectedIndices,
    selectedCount: selectedIndices.size,
    isViewportSelected: (index) => selectedIndices.has(index),
    selectViewportFromClick,
    clearSelection,
    pruneSelectionToCellCount,
  };
}

function useSelectViewportFromClickCallback(
  anchorRef: SelectionAnchorRef,
  setSelectedIndices: SelectionSetter,
): ViewportSelectionState["selectViewportFromClick"] {
  return useCallback(
    (index, modifiers) => {
      setSelectedIndices((previous) =>
        computeSelectionAfterClick(previous, anchorRef, index, modifiers),
      );
    },
    [anchorRef, setSelectedIndices],
  );
}

function useClearSelectionCallback(
  anchorRef: SelectionAnchorRef,
  setSelectedIndices: SelectionSetter,
): ViewportSelectionState["clearSelection"] {
  return useCallback(() => {
    anchorRef.current = null;
    setSelectedIndices(EMPTY_SELECTION);
  }, [anchorRef, setSelectedIndices]);
}

function usePruneSelectionToCellCountCallback(
  anchorRef: SelectionAnchorRef,
  setSelectedIndices: SelectionSetter,
): ViewportSelectionState["pruneSelectionToCellCount"] {
  return useCallback(
    (cellCount) => {
      pruneAnchorToCellCount(anchorRef, cellCount);
      setSelectedIndices((previous) => keepIndicesBelowCellCount(previous, cellCount));
    },
    [anchorRef, setSelectedIndices],
  );
}

function pruneAnchorToCellCount(anchorRef: SelectionAnchorRef, cellCount: number): void {
  if (anchorRef.current !== null && anchorRef.current >= cellCount) {
    anchorRef.current = null;
  }
}

function keepIndicesBelowCellCount(
  previous: ReadonlySet<number>,
  cellCount: number,
): ReadonlySet<number> {
  const next = new Set<number>();
  for (const index of previous) {
    if (index < cellCount) next.add(index);
  }
  return next.size === previous.size ? previous : next;
}

function computeSelectionAfterClick(
  previous: ReadonlySet<number>,
  anchorRef: SelectionAnchorRef,
  index: number,
  modifiers: ViewportSelectionClickModifiers,
): ReadonlySet<number> {
  if (modifiers.shift && anchorRef.current !== null) {
    return makeRowMajorRangeSet(anchorRef.current, index);
  }
  if (modifiers.ctrlOrMeta) {
    anchorRef.current = index;
    return toggleIndexInSelection(previous, index);
  }
  anchorRef.current = index;
  return new Set([index]);
}

function makeRowMajorRangeSet(anchor: number, current: number): ReadonlySet<number> {
  const start = Math.min(anchor, current);
  const end = Math.max(anchor, current);
  const range = new Set<number>();
  for (let index = start; index <= end; index++) range.add(index);
  return range;
}

function toggleIndexInSelection(previous: ReadonlySet<number>, index: number): ReadonlySet<number> {
  const next = new Set(previous);
  if (next.has(index)) {
    next.delete(index);
  } else {
    next.add(index);
  }
  return next;
}
