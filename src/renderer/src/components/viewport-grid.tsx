import { type MouseEvent } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Viewport } from "@/components/viewport";
import {
  getGridLayoutCellCount,
  getGridLayoutTailwindTrackClasses,
  getViewportNumberFromIndex,
  type GridLayout,
} from "@/lib/grid/grid-layout";
import { cn } from "@/lib/utils";
import type { ViewportImageSource } from "@/lib/webgl/texture";
import { useViewportDuplication } from "@/state/duplication-context";
import { useViewportRendering } from "@/state/viewport-rendering-context";
import {
  useViewportSelection,
  type ViewportSelectionClickModifiers,
} from "@/state/selection-context";

export interface ViewportCellContent {
  fileName: string;
  source: ViewportImageSource;
}

interface ViewportGridProps {
  layout: GridLayout;
  cellsByIndex: ReadonlyMap<number, ViewportCellContent>;
  onOpenImage: () => void;
}

export function ViewportGrid({
  layout,
  cellsByIndex,
  onOpenImage,
}: ViewportGridProps): JSX.Element {
  const cellCount = getGridLayoutCellCount(layout);
  const trackClasses = getGridLayoutTailwindTrackClasses(layout);
  return (
    <div
      role="grid"
      aria-label="Viewport grid"
      className={cn("grid h-full w-full gap-2", trackClasses)}
    >
      {renderViewportCells(cellCount, cellsByIndex, onOpenImage)}
    </div>
  );
}

function renderViewportCells(
  cellCount: number,
  cellsByIndex: ReadonlyMap<number, ViewportCellContent>,
  onOpenImage: () => void,
): ReadonlyArray<JSX.Element> {
  return Array.from({ length: cellCount }, (_, cellIndex) => (
    <ViewportCell
      key={cellIndex}
      cellIndex={cellIndex}
      viewportNumber={getViewportNumberFromIndex(cellIndex)}
      content={cellsByIndex.get(cellIndex) ?? null}
      onOpenImage={onOpenImage}
    />
  ));
}

interface ViewportCellProps {
  cellIndex: number;
  viewportNumber: number;
  content: ViewportCellContent | null;
  onOpenImage: () => void;
}

function ViewportCell(props: ViewportCellProps): JSX.Element {
  const settings = useViewportCellInteractionSettings(props.cellIndex);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {renderViewportCellGridcellElement(props, settings)}
      </ContextMenuTrigger>
      <ViewportCellContextMenuContent
        sourceIndex={props.cellIndex}
        sourceHasContent={props.content !== null}
      />
    </ContextMenu>
  );
}

function renderViewportCellGridcellElement(
  props: ViewportCellProps,
  settings: ViewportCellInteractionSettings,
): JSX.Element {
  return (
    <div
      role="gridcell"
      aria-selected={settings.isSelected}
      onClick={settings.handleClick}
      className={getViewportCellClassName(settings.isSelected)}
    >
      {renderViewportCellViewport(props, settings)}
    </div>
  );
}

function renderViewportCellViewport(
  props: ViewportCellProps,
  settings: ViewportCellInteractionSettings,
): JSX.Element {
  return (
    <Viewport
      viewportNumber={props.viewportNumber}
      imageSource={props.content?.source ?? null}
      fileName={props.content?.fileName ?? null}
      normalizationEnabled={settings.normalizationEnabled}
      lastAppliedOperationLabel={settings.lastAppliedOperationLabel}
      onOpenImage={props.onOpenImage}
    />
  );
}

function ViewportCellContextMenuContent(props: {
  sourceIndex: number;
  sourceHasContent: boolean;
}): JSX.Element {
  return (
    <ContextMenuContent>
      <DuplicateContextMenuItem
        sourceIndex={props.sourceIndex}
        sourceHasContent={props.sourceHasContent}
      />
    </ContextMenuContent>
  );
}

interface ViewportCellInteractionSettings {
  isSelected: boolean;
  handleClick: (event: MouseEvent<HTMLDivElement>) => void;
  normalizationEnabled: boolean;
  lastAppliedOperationLabel: string | null;
}

function useViewportCellInteractionSettings(cellIndex: number): ViewportCellInteractionSettings {
  const { isViewportSelected, selectViewportFromClick } = useViewportSelection();
  const { getRenderingState } = useViewportRendering();
  const isSelected = isViewportSelected(cellIndex);
  const renderingState = getRenderingState(cellIndex);
  const handleClick = (event: MouseEvent<HTMLDivElement>) =>
    selectViewportFromClick(cellIndex, extractClickModifiers(event));
  return {
    isSelected,
    handleClick,
    normalizationEnabled: renderingState.normalizationEnabled,
    lastAppliedOperationLabel: renderingState.lastAppliedOperationLabel,
  };
}

function getViewportCellClassName(isSelected: boolean): string {
  return cn(
    "relative min-h-0 min-w-0 rounded-md transition-shadow",
    isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
  );
}

function extractClickModifiers(event: MouseEvent<HTMLDivElement>): ViewportSelectionClickModifiers {
  return {
    ctrlOrMeta: event.ctrlKey || event.metaKey,
    shift: event.shiftKey,
  };
}

interface DuplicateContextMenuItemProps {
  sourceIndex: number;
  sourceHasContent: boolean;
}

function DuplicateContextMenuItem(props: DuplicateContextMenuItemProps): JSX.Element {
  const duplication = useViewportDuplication();
  if (!props.sourceHasContent) {
    return <ContextMenuItem disabled>Duplicate</ContextMenuItem>;
  }
  return (
    <ContextMenuItem onSelect={() => duplication.requestDuplicate(props.sourceIndex)}>
      Duplicate
    </ContextMenuItem>
  );
}
