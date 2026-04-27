export type GridLayout = "1x1" | "1x2" | "2x1" | "2x2" | "2x3" | "3x2";

export const SELECTABLE_GRID_LAYOUTS: ReadonlyArray<GridLayout> = [
  "1x1",
  "1x2",
  "2x1",
  "2x2",
  "2x3",
  "3x2",
];

interface GridDimensions {
  readonly rows: number;
  readonly cols: number;
}

const GRID_LAYOUT_TO_DIMENSIONS: Record<GridLayout, GridDimensions> = {
  "1x1": { rows: 1, cols: 1 },
  "1x2": { rows: 1, cols: 2 },
  "2x1": { rows: 2, cols: 1 },
  "2x2": { rows: 2, cols: 2 },
  "2x3": { rows: 2, cols: 3 },
  "3x2": { rows: 3, cols: 2 },
};

const GRID_LAYOUT_TO_TAILWIND_TRACK_CLASSES: Record<GridLayout, string> = {
  "1x1": "grid-cols-1 grid-rows-1",
  "1x2": "grid-cols-2 grid-rows-1",
  "2x1": "grid-cols-1 grid-rows-2",
  "2x2": "grid-cols-2 grid-rows-2",
  "2x3": "grid-cols-3 grid-rows-2",
  "3x2": "grid-cols-2 grid-rows-3",
};

export function getGridLayoutCellCount(layout: GridLayout): number {
  const { rows, cols } = GRID_LAYOUT_TO_DIMENSIONS[layout];
  return rows * cols;
}

export function getGridLayoutTailwindTrackClasses(layout: GridLayout): string {
  return GRID_LAYOUT_TO_TAILWIND_TRACK_CLASSES[layout];
}

export function getViewportNumberFromIndex(index: number): number {
  return index + 1;
}
