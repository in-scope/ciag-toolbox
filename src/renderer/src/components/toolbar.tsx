import { Fragment, type ReactNode } from "react";
import { FolderOpen, Grid2x2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { RegisteredViewportAction } from "@/lib/actions/registered-actions";
import type {
  ToolbarOperationGroup,
  ToolbarOperationItem,
} from "@/lib/actions/operation-command-bindings";
import { SELECTABLE_GRID_LAYOUTS, type GridLayout } from "@/lib/grid/grid-layout";
import { cn } from "@/lib/utils";

export type { GridLayout };

export interface ActionAvailabilityForActiveViewport {
  readonly isAvailable: boolean;
  readonly disabledReason?: string;
}

export type GetActionAvailabilityForActiveViewport = (
  action: RegisteredViewportAction,
) => ActionAvailabilityForActiveViewport;

export interface BandSubsetToolbarToggleState {
  readonly isAvailable: boolean;
  readonly isActive: boolean;
  readonly onToggle: () => void;
}

interface ToolbarProps {
  onOpenImage: () => void;
  gridLayout: GridLayout;
  onGridLayoutChange: (layout: GridLayout) => void;
  operationGroups: ReadonlyArray<ToolbarOperationGroup>;
}

export function Toolbar(props: ToolbarProps): JSX.Element {
  return (
    <TooltipProvider delayDuration={300}>
      <div role="toolbar" aria-label="Application toolbar" className={TOOLBAR_CLASSES}>
        <OpenImageButton onOpenImage={props.onOpenImage} />
        <GridLayoutDropdown
          gridLayout={props.gridLayout}
          onGridLayoutChange={props.onGridLayoutChange}
        />
        <ToolbarOperationGroups groups={props.operationGroups} />
      </div>
    </TooltipProvider>
  );
}

const TOOLBAR_CLASSES = "flex w-full flex-wrap items-center gap-2 border-b bg-card px-2 py-1.5";
const ACTIVE_TOGGLE_CLASSES =
  "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary";

function ToolbarOperationGroups({
  groups,
}: {
  groups: ReadonlyArray<ToolbarOperationGroup>;
}): JSX.Element {
  return (
    <>
      {groups.map((group) => (
        <Fragment key={group.key}>
          <ToolbarSeparator />
          {group.items.map((item) => (
            <ToolbarOperationItemButton key={item.id} item={item} />
          ))}
        </Fragment>
      ))}
    </>
  );
}

function ToolbarOperationItemButton({ item }: { item: ToolbarOperationItem }): JSX.Element {
  if (item.kind === "toggle") return <ToggleToolbarButton item={item} />;
  if (item.kind === "quick") return <QuickToolbarButton item={item} />;
  return (
    <ActionToolbarButton
      action={item.action}
      availability={item.availability}
      onInvoke={item.onInvoke}
    />
  );
}

type ToggleToolbarItem = Extract<ToolbarOperationItem, { kind: "toggle" }>;

function ToggleToolbarButton({ item }: { item: ToggleToolbarItem }): JSX.Element {
  const label = formatToggleToolbarLabel(item);
  const Icon = item.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            aria-pressed={item.isActive}
            disabled={!item.isAvailable}
            className={cn(item.isActive && ACTIVE_TOGGLE_CLASSES)}
            onClick={item.onToggle}
          >
            <Icon className="size-5" />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function formatToggleToolbarLabel(item: ToggleToolbarItem): string {
  if (!item.isAvailable && item.unavailableHint) return `${item.label} (${item.unavailableHint})`;
  if (item.isActive) return `${item.label} (active)`;
  return item.label;
}

type QuickToolbarItem = Extract<ToolbarOperationItem, { kind: "quick" }>;

function QuickToolbarButton({ item }: { item: QuickToolbarItem }): JSX.Element {
  const Icon = item.icon;
  return (
    <IconButtonWithTooltip label={item.label} onClick={item.onInvoke} disabled={!item.isAvailable}>
      <Icon className="size-5" />
    </IconButtonWithTooltip>
  );
}

function OpenImageButton({ onOpenImage }: { onOpenImage: () => void }): JSX.Element {
  return (
    <IconButtonWithTooltip label="Open image" onClick={onOpenImage}>
      <FolderOpen className="size-5" />
    </IconButtonWithTooltip>
  );
}

interface GridLayoutDropdownProps {
  gridLayout: GridLayout;
  onGridLayoutChange: (layout: GridLayout) => void;
}

function GridLayoutDropdown(props: GridLayoutDropdownProps): JSX.Element {
  const label = `Grid layout (currently ${props.gridLayout})`;
  return (
    <DropdownMenu>
      <GridLayoutDropdownTrigger label={label} />
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Grid layout</DropdownMenuLabel>
        <GridLayoutRadioOptions {...props} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function GridLayoutDropdownTrigger({ label }: { label: string }): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={label}>
            <Grid2x2 className="size-5" />
          </Button>
        </DropdownMenuTrigger>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function GridLayoutRadioOptions(props: GridLayoutDropdownProps): JSX.Element {
  return (
    <DropdownMenuRadioGroup
      value={props.gridLayout}
      onValueChange={(value) => props.onGridLayoutChange(value as GridLayout)}
    >
      {SELECTABLE_GRID_LAYOUTS.map((layout) => (
        <DropdownMenuRadioItem key={layout} value={layout}>
          {layout}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

function ToolbarSeparator(): JSX.Element {
  return (
    <div role="separator" aria-orientation="vertical" className="mx-1 h-6 w-px bg-border" />
  );
}

interface ActionToolbarButtonProps {
  action: RegisteredViewportAction;
  availability: ActionAvailabilityForActiveViewport;
  onInvoke: () => void;
}

function ActionToolbarButton(props: ActionToolbarButtonProps): JSX.Element {
  const Icon = props.action.icon;
  const disabled = !props.availability.isAvailable;
  const tooltipLabel = formatActionToolbarTooltipLabel(
    props.action.label,
    disabled,
    props.availability.disabledReason,
  );
  return (
    <IconButtonWithTooltip label={tooltipLabel} onClick={props.onInvoke} disabled={disabled}>
      <Icon className="size-5" />
    </IconButtonWithTooltip>
  );
}

function formatActionToolbarTooltipLabel(
  actionLabel: string,
  disabled: boolean,
  disabledReason: string | undefined,
): string {
  if (!disabled) return actionLabel;
  if (disabledReason) return `${actionLabel} (${disabledReason})`;
  return `${actionLabel} (select a panel with a loaded stack)`;
}

interface IconButtonWithTooltipProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}

function IconButtonWithTooltip(props: IconButtonWithTooltipProps): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <IconButton {...props} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}

function IconButton(props: IconButtonWithTooltipProps): JSX.Element {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </Button>
  );
}
