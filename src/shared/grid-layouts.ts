// The selectable panel-grid layouts, shared between the renderer's toolbar
// dropdown and the native File > Grid submenu (CT-289). Pure data: no DOM, no
// Electron. Renderer-specific derivations (cell counts, Tailwind track
// classes, grow/collapse transitions) stay in renderer/src/lib/grid.

export type GridLayout =
  | "1x1"
  | "1x2"
  | "2x1"
  | "1x3"
  | "3x1"
  | "2x2"
  | "2x3"
  | "3x2";

export const SELECTABLE_GRID_LAYOUTS: ReadonlyArray<GridLayout> = [
  "1x1",
  "1x2",
  "2x1",
  "1x3",
  "3x1",
  "2x2",
  "2x3",
  "3x2",
];

export function isSelectableGridLayout(value: string): value is GridLayout {
  return (SELECTABLE_GRID_LAYOUTS as ReadonlyArray<string>).includes(value);
}
