import type { MouseEvent } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
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
import {
  useViewportDuplication,
  type ViewportDuplicationApi,
} from "@/state/duplication-context";
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
}

export function ViewportGrid({ layout, cellsByIndex }: ViewportGridProps): JSX.Element {
  const cellCount = getGridLayoutCellCount(layout);
  const trackClasses = getGridLayoutTailwindTrackClasses(layout);
  return (
    <div
      role="grid"
      aria-label="Viewport grid"
      className={cn("grid h-full w-full gap-2", trackClasses)}
    >
      {renderViewportCells(cellCount, cellsByIndex)}
    </div>
  );
}

function renderViewportCells(
  cellCount: number,
  cellsByIndex: ReadonlyMap<number, ViewportCellContent>,
): ReadonlyArray<JSX.Element> {
  return Array.from({ length: cellCount }, (_, cellIndex) => (
    <ViewportCell
      key={cellIndex}
      cellIndex={cellIndex}
      viewportNumber={getViewportNumberFromIndex(cellIndex)}
      content={cellsByIndex.get(cellIndex) ?? null}
    />
  ));
}

interface ViewportCellProps {
  cellIndex: number;
  viewportNumber: number;
  content: ViewportCellContent | null;
}

function ViewportCell(props: ViewportCellProps): JSX.Element {
  const { isViewportSelected, selectViewportFromClick } = useViewportSelection();
  const isSelected = isViewportSelected(props.cellIndex);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="gridcell"
          aria-selected={isSelected}
          onClick={(event) => selectViewportFromClick(props.cellIndex, extractClickModifiers(event))}
          className={getViewportCellClassName(isSelected)}
        >
          <Viewport
            viewportNumber={props.viewportNumber}
            imageSource={props.content?.source ?? null}
            fileName={props.content?.fileName ?? null}
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <DuplicateToContextMenuItems
          sourceIndex={props.cellIndex}
          sourceHasContent={props.content !== null}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
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

interface DuplicateToContextMenuItemsProps {
  sourceIndex: number;
  sourceHasContent: boolean;
}

function DuplicateToContextMenuItems(props: DuplicateToContextMenuItemsProps): JSX.Element {
  const duplication = useViewportDuplication();
  if (!props.sourceHasContent || duplication.cellCount <= 1) {
    return <ContextMenuItem disabled>Duplicate to...</ContextMenuItem>;
  }
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>Duplicate to...</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {renderDuplicateTargetItems(props.sourceIndex, duplication)}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

function renderDuplicateTargetItems(
  sourceIndex: number,
  duplication: ViewportDuplicationApi,
): ReadonlyArray<JSX.Element> {
  const items: JSX.Element[] = [];
  for (let index = 0; index < duplication.cellCount; index++) {
    if (index === sourceIndex) continue;
    items.push(<DuplicateTargetItem key={index} sourceIndex={sourceIndex} targetIndex={index} />);
  }
  return items;
}

interface DuplicateTargetItemProps {
  sourceIndex: number;
  targetIndex: number;
}

function DuplicateTargetItem(props: DuplicateTargetItemProps): JSX.Element {
  const duplication = useViewportDuplication();
  const targetFileName = duplication.getCellFileName(props.targetIndex);
  const label = describeDuplicateTargetLabel(props.targetIndex, targetFileName);
  return (
    <ContextMenuItem
      onSelect={() => duplication.requestDuplicateTo(props.sourceIndex, props.targetIndex)}
    >
      {label}
    </ContextMenuItem>
  );
}

function describeDuplicateTargetLabel(targetIndex: number, fileName: string | null): string {
  const number = getViewportNumberFromIndex(targetIndex);
  if (fileName) return `Viewport ${number} (${fileName})`;
  return `Viewport ${number} (empty)`;
}
