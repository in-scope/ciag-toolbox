import type { MouseEvent } from "react";

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
