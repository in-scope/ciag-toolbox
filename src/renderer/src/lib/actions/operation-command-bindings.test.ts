import { describe, expect, it, vi } from "vitest";

import {
  listAllOperationCommands,
  OPERATION_MENUS,
} from "@shared/operation-menu-catalog";
import {
  buildToolbarOperationGroups,
  dispatchOperationCommand,
  findRegisteredActionById,
  type OperationCommandHandlers,
  type ToolbarOperationGroupContext,
} from "./operation-command-bindings";

function buildHandlerSpies(): OperationCommandHandlers & {
  calls: Record<string, number>;
} {
  const calls: Record<string, number> = {};
  const bump = (key: string) => () => {
    calls[key] = (calls[key] ?? 0) + 1;
  };
  return {
    calls,
    toggleRegionTool: bump("toggleRegionTool"),
    toggleBandSubset: bump("toggleBandSubset"),
    openActionPanel: bump("openActionPanel"),
    applyGeometricTransform: bump("applyGeometricTransform"),
  };
}

function buildToolbarContext(handlers: OperationCommandHandlers): ToolbarOperationGroupContext {
  return {
    handlers,
    getActionAvailability: () => ({ isAvailable: true }),
    regionToolActive: false,
    bandSubsetToggle: { isAvailable: true, isActive: false, onToggle: () => {} },
    isQuickTransformAvailable: true,
  };
}

describe("operation menu catalog wiring", () => {
  it("maps every open-action-panel command to a registered action with a matching label", () => {
    for (const command of listAllOperationCommands()) {
      if (command.behavior !== "open-action-panel") continue;
      const action = findRegisteredActionById(command.id);
      expect(action, `no registered action for command "${command.id}"`).not.toBeNull();
      expect(command.label).toBe(action?.label);
    }
  });

  it("opens the matching action panel for an open-action-panel command", () => {
    const handlers = buildHandlerSpies();
    const openSpy = vi.spyOn(handlers, "openActionPanel");
    dispatchOperationCommand("bit-shift", handlers);
    expect(openSpy).toHaveBeenCalledWith(findRegisteredActionById("bit-shift"));
  });

  it("routes toggle commands to their toggle handlers", () => {
    const handlers = buildHandlerSpies();
    dispatchOperationCommand("toggle-region-tool", handlers);
    dispatchOperationCommand("toggle-subset-bands", handlers);
    expect(handlers.calls.toggleRegionTool).toBe(1);
    expect(handlers.calls.toggleBandSubset).toBe(1);
  });

  it("applies a geometric transform directly for a quick command", () => {
    const handlers = buildHandlerSpies();
    dispatchOperationCommand("rotate-90-cw", handlers);
    expect(handlers.calls.applyGeometricTransform).toBe(1);
  });

  it("ignores unknown command ids", () => {
    const handlers = buildHandlerSpies();
    dispatchOperationCommand("does-not-exist", handlers);
    expect(Object.keys(handlers.calls)).toHaveLength(0);
  });
});

describe("toolbar operation groups", () => {
  it("projects every catalog group that has toolbar commands", () => {
    const groups = buildToolbarOperationGroups(buildToolbarContext(buildHandlerSpies()));
    const catalogGroupKeys = OPERATION_MENUS.flatMap((menu) => menu.groups).map((g) => g.key);
    expect(groups.map((g) => g.key)).toEqual(catalogGroupKeys);
  });

  it("includes the four toolbar-only quick transform buttons in the transform group", () => {
    const groups = buildToolbarOperationGroups(buildToolbarContext(buildHandlerSpies()));
    const transform = groups.find((group) => group.key === "transform");
    const quickIds = transform?.items.filter((item) => item.kind === "quick").map((item) => item.id);
    expect(quickIds).toEqual(["rotate-90-cw", "rotate-270-cw", "flip-horizontal", "flip-vertical"]);
  });
});
