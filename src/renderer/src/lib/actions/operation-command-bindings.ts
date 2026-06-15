import {
  BoxSelect,
  FlipHorizontal,
  FlipVertical,
  Layers,
  RotateCcw,
  RotateCw,
  type LucideIcon,
} from "lucide-react";

import {
  OPERATION_MENUS,
  findOperationCommandById,
  type OperationCommand,
  type OperationGroup,
} from "@shared/operation-menu-catalog";
import {
  isGeometricTransform,
  type GeometricTransform,
} from "@/lib/image/apply-geometric-transform";
import {
  REGISTERED_VIEWPORT_ACTIONS,
  type RegisteredViewportAction,
} from "@/lib/actions/registered-actions";
import type {
  ActionAvailabilityForActiveViewport,
  BandSubsetToolbarToggleState,
} from "@/components/toolbar";

// The catalog (shared, pure data) describes WHAT each operation command is and
// where it appears. This module binds those commands to renderer behaviour: it
// dispatches menu-bar clicks and projects the same commands into grouped
// toolbar items so the two surfaces never drift.

export interface OperationCommandHandlers {
  readonly toggleRegionTool: () => void;
  readonly toggleBandSubset: () => void;
  readonly openActionPanel: (action: RegisteredViewportAction) => void;
  readonly applyGeometricTransform: (transform: GeometricTransform) => void;
}

export function dispatchOperationCommand(
  commandId: string,
  handlers: OperationCommandHandlers,
): void {
  const command = findOperationCommandById(commandId);
  if (command) runOperationCommandBehavior(command, handlers);
}

function runOperationCommandBehavior(
  command: OperationCommand,
  handlers: OperationCommandHandlers,
): void {
  switch (command.behavior) {
    case "toggle-region-tool":
      return handlers.toggleRegionTool();
    case "toggle-subset-bands":
      return handlers.toggleBandSubset();
    case "open-action-panel":
      return openActionPanelForCommand(command, handlers);
    case "apply-geometric-transform":
      return applyGeometricTransformForCommand(command, handlers);
  }
}

function openActionPanelForCommand(
  command: OperationCommand,
  handlers: OperationCommandHandlers,
): void {
  const action = findRegisteredActionById(command.id);
  if (action) handlers.openActionPanel(action);
}

function applyGeometricTransformForCommand(
  command: OperationCommand,
  handlers: OperationCommandHandlers,
): void {
  const transform = command.geometricTransform;
  if (isGeometricTransform(transform)) handlers.applyGeometricTransform(transform);
}

export function findRegisteredActionById(
  actionId: string,
): RegisteredViewportAction | null {
  return REGISTERED_VIEWPORT_ACTIONS.find((action) => action.id === actionId) ?? null;
}

export type ToolbarOperationItem =
  | {
      readonly kind: "toggle";
      readonly id: string;
      readonly label: string;
      readonly icon: LucideIcon;
      readonly isActive: boolean;
      readonly isAvailable: boolean;
      readonly unavailableHint?: string;
      readonly onToggle: () => void;
    }
  | {
      readonly kind: "action";
      readonly id: string;
      readonly action: RegisteredViewportAction;
      readonly availability: ActionAvailabilityForActiveViewport;
      readonly onInvoke: () => void;
    }
  | {
      readonly kind: "quick";
      readonly id: string;
      readonly label: string;
      readonly icon: LucideIcon;
      readonly isAvailable: boolean;
      readonly onInvoke: () => void;
    };

export interface ToolbarOperationGroup {
  readonly key: string;
  readonly items: ReadonlyArray<ToolbarOperationItem>;
}

export interface ToolbarOperationGroupContext {
  readonly handlers: OperationCommandHandlers;
  readonly getActionAvailability: (
    action: RegisteredViewportAction,
  ) => ActionAvailabilityForActiveViewport;
  readonly regionToolActive: boolean;
  readonly bandSubsetToggle: BandSubsetToolbarToggleState;
  readonly isQuickTransformAvailable: boolean;
}

const QUICK_TRANSFORM_ICONS: Record<string, LucideIcon> = {
  "rotate-90-cw": RotateCw,
  "rotate-270-cw": RotateCcw,
  "flip-horizontal": FlipHorizontal,
  "flip-vertical": FlipVertical,
};

const SUBSET_BANDS_UNAVAILABLE_HINT = "select a multi-band stack";

export function buildToolbarOperationGroups(
  context: ToolbarOperationGroupContext,
): ToolbarOperationGroup[] {
  return OPERATION_MENUS.flatMap((menu) => menu.groups)
    .map((group) => buildToolbarOperationGroup(group, context))
    .filter((group) => group.items.length > 0);
}

function buildToolbarOperationGroup(
  group: OperationGroup,
  context: ToolbarOperationGroupContext,
): ToolbarOperationGroup {
  const items = group.commands
    .filter((command) => command.showInToolbar)
    .map((command) => buildToolbarOperationItem(command, context))
    .filter((item): item is ToolbarOperationItem => item !== null);
  return { key: group.key, items };
}

function buildToolbarOperationItem(
  command: OperationCommand,
  context: ToolbarOperationGroupContext,
): ToolbarOperationItem | null {
  switch (command.behavior) {
    case "toggle-region-tool":
      return buildRegionToggleItem(command, context);
    case "toggle-subset-bands":
      return buildBandSubsetToggleItem(command, context);
    case "open-action-panel":
      return buildActionItem(command, context);
    case "apply-geometric-transform":
      return buildQuickTransformItem(command, context);
  }
}

function buildRegionToggleItem(
  command: OperationCommand,
  context: ToolbarOperationGroupContext,
): ToolbarOperationItem {
  return {
    kind: "toggle",
    id: command.id,
    label: command.label,
    icon: BoxSelect,
    isActive: context.regionToolActive,
    isAvailable: true,
    onToggle: context.handlers.toggleRegionTool,
  };
}

function buildBandSubsetToggleItem(
  command: OperationCommand,
  context: ToolbarOperationGroupContext,
): ToolbarOperationItem {
  return {
    kind: "toggle",
    id: command.id,
    label: command.label,
    icon: Layers,
    isActive: context.bandSubsetToggle.isActive,
    isAvailable: context.bandSubsetToggle.isAvailable,
    unavailableHint: SUBSET_BANDS_UNAVAILABLE_HINT,
    onToggle: context.handlers.toggleBandSubset,
  };
}

function buildActionItem(
  command: OperationCommand,
  context: ToolbarOperationGroupContext,
): ToolbarOperationItem | null {
  const action = findRegisteredActionById(command.id);
  if (!action) return null;
  return {
    kind: "action",
    id: command.id,
    action,
    availability: context.getActionAvailability(action),
    onInvoke: () => context.handlers.openActionPanel(action),
  };
}

function buildQuickTransformItem(
  command: OperationCommand,
  context: ToolbarOperationGroupContext,
): ToolbarOperationItem | null {
  const transform = command.geometricTransform;
  if (!isGeometricTransform(transform)) return null;
  return {
    kind: "quick",
    id: command.id,
    label: command.label,
    icon: QUICK_TRANSFORM_ICONS[command.id] ?? RotateCw,
    isAvailable: context.isQuickTransformAvailable,
    onInvoke: () => context.handlers.applyGeometricTransform(transform),
  };
}
