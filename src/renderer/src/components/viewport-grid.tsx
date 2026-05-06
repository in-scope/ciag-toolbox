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
import { useViewportClosing } from "@/state/closing-context";
import { useViewportDuplication } from "@/state/duplication-context";
import { useViewportRendering } from "@/state/viewport-rendering-context";
import {
  useViewportSelection,
  type ViewportSelectionClickModifiers,
} from "@/state/selection-context";

export interface ViewportCellContent {
  fileName: string;
  source: ViewportImageSource;
  originalFilePath?: string;
  originalContentHash?: string;
}

interface ViewportGridProps {
  layout: GridLayout;
  cellsByIndex: ReadonlyMap<number, ViewportCellContent>;
  unresolvedFileNamesByIndex?: ReadonlyMap<number, string>;
  onOpenImage: () => void;
}

export function ViewportGrid(props: ViewportGridProps): JSX.Element {
  const cellCount = getGridLayoutCellCount(props.layout);
  const trackClasses = getGridLayoutTailwindTrackClasses(props.layout);
  return (
    <div
      role="grid"
      aria-label="Viewport grid"
      className={cn("grid h-full w-full gap-2", trackClasses)}
    >
      {renderViewportCells(cellCount, props)}
    </div>
  );
}

function renderViewportCells(
  cellCount: number,
  props: ViewportGridProps,
): ReadonlyArray<JSX.Element> {
  return Array.from({ length: cellCount }, (_, cellIndex) => (
    <ViewportCell
      key={cellIndex}
      cellIndex={cellIndex}
      viewportNumber={getViewportNumberFromIndex(cellIndex)}
      content={props.cellsByIndex.get(cellIndex) ?? null}
      unresolvedFileName={props.unresolvedFileNamesByIndex?.get(cellIndex) ?? null}
      onOpenImage={props.onOpenImage}
    />
  ));
}

interface ViewportCellProps {
  cellIndex: number;
  viewportNumber: number;
  content: ViewportCellContent | null;
  unresolvedFileName: string | null;
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
      fileName={props.content?.fileName ?? props.unresolvedFileName ?? null}
      unresolvedFileName={props.unresolvedFileName}
      normalizationEnabled={settings.normalizationEnabled}
      selectedBandIndex={settings.selectedBandIndex}
      lastAppliedOperationLabel={settings.lastAppliedOperationLabel}
      onOpenImage={props.onOpenImage}
      onClose={settings.handleClose}
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
      <CloseContextMenuItem
        sourceIndex={props.sourceIndex}
        sourceHasContent={props.sourceHasContent}
      />
    </ContextMenuContent>
  );
}

interface ViewportCellInteractionSettings {
  isSelected: boolean;
  handleClick: (event: MouseEvent<HTMLDivElement>) => void;
  handleClose: (() => void) | undefined;
  normalizationEnabled: boolean;
  selectedBandIndex: number;
  lastAppliedOperationLabel: string | null;
}

function useViewportCellInteractionSettings(cellIndex: number): ViewportCellInteractionSettings {
  const { isViewportSelected, selectViewportFromClick } = useViewportSelection();
  const { getRenderingState } = useViewportRendering();
  const closing = useViewportClosing();
  const isSelected = isViewportSelected(cellIndex);
  const renderingState = getRenderingState(cellIndex);
  const handleClick = (event: MouseEvent<HTMLDivElement>) =>
    selectViewportFromClick(cellIndex, extractClickModifiers(event));
  const handleClose = closing.hasContent(cellIndex)
    ? () => closing.closeViewport(cellIndex)
    : undefined;
  return {
    isSelected,
    handleClick,
    handleClose,
    normalizationEnabled: renderingState.normalizationEnabled,
    selectedBandIndex: renderingState.selectedBandIndex,
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

interface CloseContextMenuItemProps {
  sourceIndex: number;
  sourceHasContent: boolean;
}

function CloseContextMenuItem(props: CloseContextMenuItemProps): JSX.Element {
  const closing = useViewportClosing();
  if (!props.sourceHasContent) {
    return <ContextMenuItem disabled>Close</ContextMenuItem>;
  }
  return (
    <ContextMenuItem onSelect={() => closing.closeViewport(props.sourceIndex)}>
      Close
    </ContextMenuItem>
  );
}
