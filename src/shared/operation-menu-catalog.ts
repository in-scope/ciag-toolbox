// Single source of truth for the operation menus (Edit, Image, Adjust,
// Process, Spectral).
//
// Both the native application menu (main process) and the React toolbar
// (renderer) derive their structure from this catalog so the two surfaces stay
// in sync: every operation in the menu bar is reachable, and the toolbar is a
// regrouped projection of the same commands plus a few toolbar-only quick
// variants that apply directly without opening a side panel.
//
// Toolbar rule: a command is showInToolbar only if it is a mode toggle
// (Select Region, Subset Bands), a one-click direct apply with zero
// parameters (the quick rotate/flip variants), or an everyday panel-opener
// used in essentially every session (Crop, Tone Curve, Brightness &
// Contrast). Parameterized pipeline operations are menu-only.
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
    buildMenuOnlyActionCommand("invert", "Invert"),
  ],
};

const CLIP_GROUP: OperationGroup = {
  key: "clip",
  commands: [
    buildMenuOnlyActionCommand("threshold", "Threshold"),
    buildMenuOnlyActionCommand("percentile-clip", "Percentile Clip"),
  ],
};

const COLOR_GROUP: OperationGroup = {
  key: "color",
  commands: [
    buildMenuOnlyActionCommand("rgb-to-grayscale", "RGB to Grayscale"),
    buildMenuOnlyActionCommand("false-color", "False-color Composite"),
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
    buildMenuOnlyActionCommand("flat-field", "Flat-field Correction"),
    buildMenuOnlyActionCommand("spectralon", "Spectralon Calibration"),
  ],
};

const DATA_GROUP: OperationGroup = {
  key: "data",
  commands: [
    buildMenuOnlyActionCommand("bit-shift", "Bit Shift"),
    buildMenuOnlyActionCommand("normalize-data", "Normalize"),
    buildMenuOnlyActionCommand("standardize", "Standardize"),
  ],
};

// Neighborhood filters (CT-200..CT-205 landed here).
const FILTERS_GROUP: OperationGroup = {
  key: "filters",
  commands: [
    buildMenuOnlyActionCommand("spatial-filter", "Spatial Filter"),
    buildMenuOnlyActionCommand("denoise", "Denoise"),
  ],
};

const SPECTRAL_DERIVATIVE_GROUP: OperationGroup = {
  key: "spectral-derivative",
  commands: [buildMenuOnlyActionCommand("spectral-derivative", "Spectral Derivative")],
};

const DIMENSION_REDUCTION_GROUP: OperationGroup = {
  key: "dimension-reduction",
  commands: [
    buildMenuOnlyActionCommand("pca", "PCA"),
    buildMenuOnlyActionCommand("mnf", "MNF"),
    buildMenuOnlyActionCommand("ica", "ICA"),
  ],
};

// Stage 5 band-combining operations gated behind the scripting worker
// (CT-209, CT-210).
const BAND_OPS_GROUP: OperationGroup = {
  key: "band-ops",
  commands: [
    buildMenuOnlyActionCommand("band-weighting", "Band Weighting"),
    buildMenuOnlyActionCommand("band-selection", "Band Selection"),
  ],
};

// Whole-cube user scripting (CT-216).
const SCRIPTS_GROUP: OperationGroup = {
  key: "scripts",
  commands: [buildMenuOnlyActionCommand("custom-transform", "Custom Transform")],
};

export const EDIT_MENU: OperationMenu = {
  menuLabel: "Edit",
  groups: [SELECTION_GROUP, EDIT_REGION_GROUP],
};

// Geometry and color representation: changes what the image IS, not its values.
export const IMAGE_MENU: OperationMenu = {
  menuLabel: "Image",
  groups: [TRANSFORM_GROUP, COLOR_GROUP],
};

// Per-pixel intensity mapping.
export const ADJUST_MENU: OperationMenu = {
  menuLabel: "Adjust",
  groups: [ADJUST_GROUP, CLIP_GROUP],
};

// Correcting and conditioning data values: calibration, numeric conditioning,
// neighborhood filtering.
export const PROCESS_MENU: OperationMenu = {
  menuLabel: "Process",
  groups: [CALIBRATE_GROUP, DATA_GROUP, FILTERS_GROUP],
};

// Operations across the band dimension or the whole cube.
export const SPECTRAL_MENU: OperationMenu = {
  menuLabel: "Spectral",
  groups: [
    SPECTRAL_DERIVATIVE_GROUP,
    DIMENSION_REDUCTION_GROUP,
    BAND_OPS_GROUP,
    SCRIPTS_GROUP,
  ],
};

export const OPERATION_MENUS: ReadonlyArray<OperationMenu> = [
  EDIT_MENU,
  IMAGE_MENU,
  ADJUST_MENU,
  PROCESS_MENU,
  SPECTRAL_MENU,
];

export function listAllOperationCommands(): ReadonlyArray<OperationCommand> {
  return OPERATION_MENUS.flatMap((menu) => menu.groups).flatMap((group) => group.commands);
}

export function findOperationCommandById(commandId: string): OperationCommand | null {
  return listAllOperationCommands().find((command) => command.id === commandId) ?? null;
}
