import { describe, expect, it } from "vitest";

import {
  listAllOperationCommands,
  OPERATION_MENUS,
  type OperationMenu,
} from "./operation-menu-catalog";

function listMenuItemLabels(menu: OperationMenu): string[] {
  return menu.groups
    .flatMap((group) => group.commands)
    .filter((command) => command.showInMenu)
    .map((command) => command.label);
}

function findMenuByLabel(menuLabel: string): OperationMenu {
  const menu = OPERATION_MENUS.find((candidate) => candidate.menuLabel === menuLabel);
  if (!menu) throw new Error(`no operation menu labelled "${menuLabel}"`);
  return menu;
}

describe("operation menu structure", () => {
  it("orders the operation menus Edit, Image, Adjust, Process, Spectral", () => {
    expect(OPERATION_MENUS.map((menu) => menu.menuLabel)).toEqual([
      "Edit",
      "Image",
      "Adjust",
      "Process",
      "Spectral",
    ]);
  });

  it("keeps selection and crop under Edit", () => {
    expect(listMenuItemLabels(findMenuByLabel("Edit"))).toEqual([
      "Select Region",
      "Subset Bands",
      "Crop to Region",
    ]);
  });

  it("puts geometry and color representation under Image", () => {
    expect(listMenuItemLabels(findMenuByLabel("Image"))).toEqual([
      "Rotate",
      "Reflect",
      "RGB to Grayscale",
      "False-color Composite",
    ]);
  });

  it("puts per-pixel intensity mapping under Adjust", () => {
    expect(listMenuItemLabels(findMenuByLabel("Adjust"))).toEqual([
      "Tone Curve",
      "Brightness & Contrast",
      "Invert",
      "Threshold",
      "Percentile Clip",
    ]);
  });

  it("puts calibration, data conditioning, and filters under Process", () => {
    expect(listMenuItemLabels(findMenuByLabel("Process"))).toEqual([
      "Flat-field Correction",
      "Spectralon Calibration",
      "Bit Shift",
      "Normalize",
      "Standardize",
      "Spatial Filter",
      "Denoise",
    ]);
  });

  it("puts band-dimension and whole-cube operations under Spectral", () => {
    expect(listMenuItemLabels(findMenuByLabel("Spectral"))).toEqual([
      "Spectral Derivative",
      "PCA",
      "MNF",
      "ICA",
      "Band Weighting",
      "Band Selection",
      "Custom Transform",
    ]);
  });
});

describe("toolbar allowlist", () => {
  // The toolbar rule: mode toggles, zero-parameter one-click applies, and the
  // everyday panel-openers. Parameterized pipeline operations are menu-only.
  it("marks exactly the allowed commands showInToolbar", () => {
    const toolbarIds = listAllOperationCommands()
      .filter((command) => command.showInToolbar)
      .map((command) => command.id);
    expect(toolbarIds).toEqual([
      "toggle-region-tool",
      "toggle-subset-bands",
      "crop-to-region",
      "rotate-90-cw",
      "rotate-270-cw",
      "flip-horizontal",
      "flip-vertical",
      "tone-curve",
      "brightness-contrast",
    ]);
  });
});

describe("catalog integrity", () => {
  it("never reuses a command id or label", () => {
    const commands = listAllOperationCommands();
    const ids = commands.map((command) => command.id);
    const labels = commands.map((command) => command.label);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
