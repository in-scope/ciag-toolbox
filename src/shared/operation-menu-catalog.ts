// Single source of truth for the Edit and Image operation menus.
//
// Both the native application menu (main process) and the React toolbar
// (renderer) derive their structure from this catalog so the two surfaces stay
// in sync: every operation in the menu bar is reachable, and the toolbar is a
// regrouped projection of the same commands plus a few toolbar-only quick
// variants that apply directly without opening a side panel.
//
// This module is intentionally pure data: no DOM, no Electron, no React. Icons
// and behaviour bindings live in the renderer because they are environment
// specific; this file only describes labels, grouping, and intent.

export type OperationCommandBehavior =
  | "toggle-region-tool"
  | "toggle-subset-bands"
  | "open-action-panel"
  | "apply-geometric-transform";

export interface OperationCommand {
  readonly id: string;
  readonly label: string;
  readonly behavior: OperationCommandBehavior;
  // Present only when behavior is "apply-geometric-transform"; the value is a
  // GeometricTransform literal validated on the renderer side.
  readonly geometricTransform?: string;
  readonly showInMenu: boolean;
  readonly showInToolbar: boolean;
}

export interface OperationGroup {
  readonly key: string;
  readonly commands: ReadonlyArray<OperationCommand>;
}

export interface OperationMenu {
  readonly menuLabel: string;
  readonly groups: ReadonlyArray<OperationGroup>;
}

function buildMenuAndToolbarCommand(
  id: string,
  label: string,
  behavior: OperationCommandBehavior,
): OperationCommand {
  return { id, label, behavior, showInMenu: true, showInToolbar: true };
}

function buildMenuOnlyActionCommand(id: string, label: string): OperationCommand {
  return { id, label, behavior: "open-action-panel", showInMenu: true, showInToolbar: false };
}

function buildToolbarOnlyTransformCommand(
  geometricTransform: string,
  label: string,
): OperationCommand {
  return {
    id: geometricTransform,
    label,
    behavior: "apply-geometric-transform",
    geometricTransform,
    showInMenu: false,
    showInToolbar: true,
  };
}

const SELECTION_GROUP: OperationGroup = {
  key: "selection",
  commands: [
    buildMenuAndToolbarCommand("toggle-region-tool", "Select Region", "toggle-region-tool"),
    buildMenuAndToolbarCommand("toggle-subset-bands", "Subset Bands", "toggle-subset-bands"),
  ],
};

const EDIT_REGION_GROUP: OperationGroup = {
  key: "edit-region",
  commands: [
    buildMenuAndToolbarCommand("crop-to-region", "Crop to Region", "open-action-panel"),
  ],
};

const ADJUST_GROUP: OperationGroup = {
  key: "adjust",
  commands: [
    buildMenuAndToolbarCommand("tone-curve", "Tone Curve", "open-action-panel"),
    buildMenuAndToolbarCommand("brightness-contrast", "Brightness & Contrast", "open-action-panel"),
    buildMenuAndToolbarCommand("invert", "Invert", "open-action-panel"),
  ],
};

const COLOR_GROUP: OperationGroup = {
  key: "color",
  commands: [
    buildMenuAndToolbarCommand("rgb-to-grayscale", "RGB to Grayscale", "open-action-panel"),
    buildMenuAndToolbarCommand("false-color", "False-color Composite", "open-action-panel"),
  ],
};

const TRANSFORM_GROUP: OperationGroup = {
  key: "transform",
  commands: [
    // Rotate and Reflect are separate operations: each opens its own panel (Rotate
    // also offers the rotate-180 that has no one-click button). The toolbar carries
    // only the narrow direct-apply variants to avoid redundant duplicate buttons.
    buildMenuOnlyActionCommand("rotate", "Rotate"),
    buildMenuOnlyActionCommand("reflect", "Reflect"),
    buildToolbarOnlyTransformCommand("rotate-90-cw", "Rotate 90° clockwise"),
    buildToolbarOnlyTransformCommand("rotate-270-cw", "Rotate 90° counterclockwise"),
    buildToolbarOnlyTransformCommand("flip-horizontal", "Reflect horizontally"),
    buildToolbarOnlyTransformCommand("flip-vertical", "Reflect vertically"),
  ],
};

const CALIBRATE_GROUP: OperationGroup = {
  key: "calibrate",
  commands: [
    buildMenuAndToolbarCommand("flat-field", "Flat-field Correction", "open-action-panel"),
    buildMenuAndToolbarCommand("spectralon", "Spectralon Calibration", "open-action-panel"),
  ],
};

const DATA_GROUP: OperationGroup = {
  key: "data",
  commands: [
    buildMenuAndToolbarCommand("bit-shift", "Bit Shift", "open-action-panel"),
    buildMenuAndToolbarCommand("normalize-data", "Normalize", "open-action-panel"),
    buildMenuAndToolbarCommand("standardize", "Standardize", "open-action-panel"),
  ],
};

export const EDIT_MENU: OperationMenu = {
  menuLabel: "Edit",
  groups: [SELECTION_GROUP, EDIT_REGION_GROUP],
};

export const IMAGE_MENU: OperationMenu = {
  menuLabel: "Image",
  groups: [ADJUST_GROUP, COLOR_GROUP, TRANSFORM_GROUP, CALIBRATE_GROUP, DATA_GROUP],
};

export const OPERATION_MENUS: ReadonlyArray<OperationMenu> = [EDIT_MENU, IMAGE_MENU];

export function listAllOperationCommands(): ReadonlyArray<OperationCommand> {
  return OPERATION_MENUS.flatMap((menu) => menu.groups).flatMap((group) => group.commands);
}

export function findOperationCommandById(commandId: string): OperationCommand | null {
  return listAllOperationCommands().find((command) => command.id === commandId) ?? null;
}
