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

import {
  compactAnchorAfterRemovingIndex,
  compactIndexedSetAfterRemovingIndex,
} from "@/lib/grid/compact-indexed-map";
import {
  computeSelectionAfterClick,
  computeSelectionAfterContextMenuClick,
  type ViewportSelectionAfterClick,
  type ViewportSelectionClickModifiers,
} from "@/lib/grid/viewport-selection-click";

export type { ViewportSelectionClickModifiers } from "@/lib/grid/viewport-selection-click";

export interface ViewportSelectionState {
  selectedIndices: ReadonlySet<number>;
  selectedCount: number;
  isViewportSelected: (index: number) => boolean;
  selectViewportFromClick: (index: number, modifiers: ViewportSelectionClickModifiers) => void;
  selectViewportFromContextMenuClick: (index: number) => void;
  replaceSelection: (indices: ReadonlySet<number>) => void;
  clearSelection: () => void;
  pruneSelectionToCellCount: (cellCount: number) => void;
  compactSelectionAfterRemovingIndex: (removedIndex: number) => void;
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
  const selectViewportFromContextMenuClick = useSelectViewportFromContextMenuClickCallback(
    anchorRef,
    setSelectedIndices,
  );
  const replaceSelection = useReplaceSelectionCallback(anchorRef, setSelectedIndices);
  const clearSelection = useClearSelectionCallback(anchorRef, setSelectedIndices);
  const pruneSelectionToCellCount = usePruneSelectionToCellCountCallback(
    anchorRef,
    setSelectedIndices,
  );
  const compactSelectionAfterRemovingIndex = useCompactSelectionCallback(
    anchorRef,
    setSelectedIndices,
  );
  return useMemo(
    () =>
      buildSelectionState({
        selectedIndices,
        selectViewportFromClick,
        selectViewportFromContextMenuClick,
        replaceSelection,
        clearSelection,
        pruneSelectionToCellCount,
        compactSelectionAfterRemovingIndex,
      }),
    [
      selectedIndices,
      selectViewportFromClick,
      selectViewportFromContextMenuClick,
      replaceSelection,
      clearSelection,
      pruneSelectionToCellCount,
      compactSelectionAfterRemovingIndex,
    ],
  );
}

function useReplaceSelectionCallback(
  anchorRef: SelectionAnchorRef,
  setSelectedIndices: SelectionSetter,
): ViewportSelectionState["replaceSelection"] {
  return useCallback(
    (indices) => {
      anchorRef.current = pickFirstIndexFromSetOrNull(indices);
      setSelectedIndices(new Set(indices));
    },
    [anchorRef, setSelectedIndices],
  );
}

function pickFirstIndexFromSetOrNull(indices: ReadonlySet<number>): number | null {
  for (const value of indices) return value;
  return null;
}

interface SelectionStateInputs {
  selectedIndices: ReadonlySet<number>;
  selectViewportFromClick: ViewportSelectionState["selectViewportFromClick"];
  selectViewportFromContextMenuClick: ViewportSelectionState["selectViewportFromContextMenuClick"];
  replaceSelection: ViewportSelectionState["replaceSelection"];
  clearSelection: ViewportSelectionState["clearSelection"];
  pruneSelectionToCellCount: ViewportSelectionState["pruneSelectionToCellCount"];
  compactSelectionAfterRemovingIndex: ViewportSelectionState["compactSelectionAfterRemovingIndex"];
}

function buildSelectionState(inputs: SelectionStateInputs): ViewportSelectionState {
  return {
    selectedIndices: inputs.selectedIndices,
    selectedCount: inputs.selectedIndices.size,
    isViewportSelected: (index) => inputs.selectedIndices.has(index),
    selectViewportFromClick: inputs.selectViewportFromClick,
    selectViewportFromContextMenuClick: inputs.selectViewportFromContextMenuClick,
    replaceSelection: inputs.replaceSelection,
    clearSelection: inputs.clearSelection,
    pruneSelectionToCellCount: inputs.pruneSelectionToCellCount,
    compactSelectionAfterRemovingIndex: inputs.compactSelectionAfterRemovingIndex,
  };
}

function useSelectViewportFromClickCallback(
  anchorRef: SelectionAnchorRef,
  setSelectedIndices: SelectionSetter,
): ViewportSelectionState["selectViewportFromClick"] {
  return useCallback(
    (index, modifiers) => {
      setSelectedIndices((previous) =>
        applySelectionResultToAnchorRef(
          computeSelectionAfterClick(previous, anchorRef.current, index, modifiers),
          anchorRef,
        ),
      );
    },
    [anchorRef, setSelectedIndices],
  );
}

function useSelectViewportFromContextMenuClickCallback(
  anchorRef: SelectionAnchorRef,
  setSelectedIndices: SelectionSetter,
): ViewportSelectionState["selectViewportFromContextMenuClick"] {
  return useCallback(
    (index) => {
      setSelectedIndices((previous) =>
        applySelectionResultToAnchorRef(
          computeSelectionAfterContextMenuClick(previous, anchorRef.current, index),
          anchorRef,
        ),
      );
    },
    [anchorRef, setSelectedIndices],
  );
}

function applySelectionResultToAnchorRef(
  result: ViewportSelectionAfterClick,
  anchorRef: SelectionAnchorRef,
): ReadonlySet<number> {
  anchorRef.current = result.anchor;
  return result.selection;
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

function useCompactSelectionCallback(
  anchorRef: SelectionAnchorRef,
  setSelectedIndices: SelectionSetter,
): ViewportSelectionState["compactSelectionAfterRemovingIndex"] {
  return useCallback(
    (removedIndex) => {
      anchorRef.current = compactAnchorAfterRemovingIndex(anchorRef.current, removedIndex);
      setSelectedIndices((previous) => compactIndexedSetAfterRemovingIndex(previous, removedIndex));
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

