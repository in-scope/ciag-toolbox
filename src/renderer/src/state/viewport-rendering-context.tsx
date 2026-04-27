import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import {
  DEFAULT_VIEWPORT_RENDERING_STATE,
  type ViewportRenderingState,
} from "@/lib/actions/viewport-action";

export type ViewportRenderingByIndex = ReadonlyMap<number, ViewportRenderingState>;

export interface ViewportRenderingApi {
  getRenderingState: (viewportIndex: number) => ViewportRenderingState;
  setRenderingState: (viewportIndex: number, next: ViewportRenderingState) => void;
  pruneRenderingStateToCellCount: (cellCount: number) => void;
}

const ViewportRenderingContext = createContext<ViewportRenderingApi | null>(null);

interface ViewportRenderingProviderProps {
  children: ReactNode;
}

export function ViewportRenderingProvider({
  children,
}: ViewportRenderingProviderProps): JSX.Element {
  const value = useViewportRenderingInternalState();
  return (
    <ViewportRenderingContext.Provider value={value}>
      {children}
    </ViewportRenderingContext.Provider>
  );
}

export function useViewportRendering(): ViewportRenderingApi {
  const value = useContext(ViewportRenderingContext);
  if (!value) {
    throw new Error("useViewportRendering must be used inside a ViewportRenderingProvider");
  }
  return value;
}

const EMPTY_RENDERING_MAP: ViewportRenderingByIndex = new Map();

function useViewportRenderingInternalState(): ViewportRenderingApi {
  const [renderingByIndex, setRenderingByIndex] =
    useState<ViewportRenderingByIndex>(EMPTY_RENDERING_MAP);
  const getRenderingState = useGetRenderingStateCallback(renderingByIndex);
  const setRenderingState = useSetRenderingStateCallback(setRenderingByIndex);
  const pruneRenderingStateToCellCount = usePruneRenderingStateCallback(setRenderingByIndex);
  return useMemo(
    () => ({ getRenderingState, setRenderingState, pruneRenderingStateToCellCount }),
    [getRenderingState, setRenderingState, pruneRenderingStateToCellCount],
  );
}

function useGetRenderingStateCallback(
  renderingByIndex: ViewportRenderingByIndex,
): ViewportRenderingApi["getRenderingState"] {
  return useCallback(
    (viewportIndex) => readRenderingStateOrDefault(renderingByIndex, viewportIndex),
    [renderingByIndex],
  );
}

type ViewportRenderingSetter = Dispatch<SetStateAction<ViewportRenderingByIndex>>;

function useSetRenderingStateCallback(
  setRenderingByIndex: ViewportRenderingSetter,
): ViewportRenderingApi["setRenderingState"] {
  return useCallback(
    (viewportIndex, next) => {
      setRenderingByIndex((previous) =>
        writeRenderingStateAtIndex(previous, viewportIndex, next),
      );
    },
    [setRenderingByIndex],
  );
}

function usePruneRenderingStateCallback(
  setRenderingByIndex: ViewportRenderingSetter,
): ViewportRenderingApi["pruneRenderingStateToCellCount"] {
  return useCallback(
    (cellCount) => {
      setRenderingByIndex((previous) => keepRenderingEntriesBelowCellCount(previous, cellCount));
    },
    [setRenderingByIndex],
  );
}

function readRenderingStateOrDefault(
  map: ViewportRenderingByIndex,
  viewportIndex: number,
): ViewportRenderingState {
  return map.get(viewportIndex) ?? DEFAULT_VIEWPORT_RENDERING_STATE;
}

function writeRenderingStateAtIndex(
  previous: ViewportRenderingByIndex,
  viewportIndex: number,
  next: ViewportRenderingState,
): ViewportRenderingByIndex {
  const updated = new Map(previous);
  updated.set(viewportIndex, next);
  return updated;
}

function keepRenderingEntriesBelowCellCount(
  previous: ViewportRenderingByIndex,
  cellCount: number,
): ViewportRenderingByIndex {
  const updated = new Map<number, ViewportRenderingState>();
  let removedAny = false;
  for (const [index, value] of previous) {
    if (index < cellCount) updated.set(index, value);
    else removedAny = true;
  }
  return removedAny ? updated : previous;
}
