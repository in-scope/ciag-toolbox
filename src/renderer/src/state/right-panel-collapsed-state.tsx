import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type RightPanelSectionId = "pixel-inspector" | "histogram";

export interface RightPanelCollapsedStateApi {
  readonly isSectionCollapsed: (sectionId: RightPanelSectionId) => boolean;
  readonly setSectionCollapsed: (sectionId: RightPanelSectionId, collapsed: boolean) => void;
}

const RightPanelCollapsedStateContext = createContext<RightPanelCollapsedStateApi | null>(null);

interface RightPanelCollapsedStateProviderProps {
  children: ReactNode;
}

export function RightPanelCollapsedStateProvider(
  props: RightPanelCollapsedStateProviderProps,
): JSX.Element {
  const [collapsedSections, setCollapsedSections] = useState<ReadonlySet<RightPanelSectionId>>(
    () => new Set(),
  );
  const setSectionCollapsed = useCallback(
    (sectionId: RightPanelSectionId, collapsed: boolean) =>
      setCollapsedSections((prev) => buildNextCollapsedSet(prev, sectionId, collapsed)),
    [],
  );
  const isSectionCollapsed = useCallback(
    (sectionId: RightPanelSectionId) => collapsedSections.has(sectionId),
    [collapsedSections],
  );
  const api = useMemo<RightPanelCollapsedStateApi>(
    () => ({ isSectionCollapsed, setSectionCollapsed }),
    [isSectionCollapsed, setSectionCollapsed],
  );
  return (
    <RightPanelCollapsedStateContext.Provider value={api}>
      {props.children}
    </RightPanelCollapsedStateContext.Provider>
  );
}

function buildNextCollapsedSet(
  prev: ReadonlySet<RightPanelSectionId>,
  sectionId: RightPanelSectionId,
  collapsed: boolean,
): ReadonlySet<RightPanelSectionId> {
  const next = new Set(prev);
  if (collapsed) next.add(sectionId);
  else next.delete(sectionId);
  return next;
}

export function useRightPanelCollapsedSection(
  sectionId: RightPanelSectionId,
): { isCollapsed: boolean; setCollapsed: (collapsed: boolean) => void } {
  const api = useContext(RightPanelCollapsedStateContext);
  if (!api) {
    throw new Error(
      "useRightPanelCollapsedSection must be used inside a RightPanelCollapsedStateProvider",
    );
  }
  return {
    isCollapsed: api.isSectionCollapsed(sectionId),
    setCollapsed: (collapsed: boolean) => api.setSectionCollapsed(sectionId, collapsed),
  };
}
