import { Viewport } from "@/components/viewport";
import {
  getGridLayoutCellCount,
  getGridLayoutTailwindTrackClasses,
  getViewportNumberFromIndex,
  type GridLayout,
} from "@/lib/grid/grid-layout";
import { cn } from "@/lib/utils";
import type { ViewportImageSource } from "@/lib/webgl/texture";

export interface ViewportCellContent {
  fileName: string;
  source: ViewportImageSource;
}

interface ViewportGridProps {
  layout: GridLayout;
  cellsByIndex: ReadonlyMap<number, ViewportCellContent>;
}

export function ViewportGrid({
  layout,
  cellsByIndex,
}: ViewportGridProps): JSX.Element {
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
      viewportNumber={getViewportNumberFromIndex(cellIndex)}
      content={cellsByIndex.get(cellIndex) ?? null}
    />
  ));
}

interface ViewportCellProps {
  viewportNumber: number;
  content: ViewportCellContent | null;
}

function ViewportCell({
  viewportNumber,
  content,
}: ViewportCellProps): JSX.Element {
  return (
    <div role="gridcell" className="min-h-0 min-w-0">
      <Viewport
        viewportNumber={viewportNumber}
        imageSource={content?.source ?? null}
        fileName={content?.fileName ?? null}
      />
    </div>
  );
}
