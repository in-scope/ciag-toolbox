// The panel form controls the app hand-rolls (a native number input and a
// native select, both outside shadcn's component set) share one appearance, so
// the Tailwind token strings live here rather than being copied per panel.

export const PANEL_NUMERIC_INPUT_CLASSES =
  "h-8 rounded-md border bg-background px-2 font-mono text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export const PANEL_SELECT_CLASSES =
  "h-8 rounded-md border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
