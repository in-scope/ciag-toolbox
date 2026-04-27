import type { ReactNode } from "react";
import { FolderOpen, Grid2x2, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ViewportAction } from "@/lib/actions/viewport-action";
import { SELECTABLE_GRID_LAYOUTS, type GridLayout } from "@/lib/grid/grid-layout";
import { useViewportSelection } from "@/state/selection-context";

export type { GridLayout };

interface ToolbarProps {
  onOpenImage: () => void;
  gridLayout: GridLayout;
  onGridLayoutChange: (layout: GridLayout) => void;
  registeredActions: ReadonlyArray<ViewportAction>;
  onInvokeAction: (action: ViewportAction) => void;
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
        <ApplyToSelectedActionMenu
          registeredActions={props.registeredActions}
          onInvokeAction={props.onInvokeAction}
        />
      </div>
    </TooltipProvider>
  );
}

const TOOLBAR_CLASSES = "flex w-full flex-wrap items-center gap-2 border-b bg-card px-2 py-1.5";

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

interface ApplyToSelectedActionMenuProps {
  registeredActions: ReadonlyArray<ViewportAction>;
  onInvokeAction: (action: ViewportAction) => void;
}

function ApplyToSelectedActionMenu(props: ApplyToSelectedActionMenuProps): JSX.Element {
  const { selectedCount } = useViewportSelection();
  const label = describeApplyToSelected(selectedCount);
  if (selectedCount === 0) {
    return <DisabledApplyToSelectedButton label={label} />;
  }
  return <EnabledApplyToSelectedDropdown label={label} {...props} />;
}

function DisabledApplyToSelectedButton({ label }: { label: string }): JSX.Element {
  return (
    <IconButtonWithTooltip label={label} onClick={noopApplyHandler} disabled>
      <Play className="size-5" />
    </IconButtonWithTooltip>
  );
}

function noopApplyHandler(): void {
  // Apply-to-selected is a no-op when nothing is selected.
}

interface EnabledApplyToSelectedDropdownProps extends ApplyToSelectedActionMenuProps {
  label: string;
}

function EnabledApplyToSelectedDropdown(
  props: EnabledApplyToSelectedDropdownProps,
): JSX.Element {
  return (
    <DropdownMenu>
      <ApplyToSelectedDropdownTrigger label={props.label} />
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Apply to selected</DropdownMenuLabel>
        {renderActionMenuItems(props.registeredActions, props.onInvokeAction)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ApplyToSelectedDropdownTrigger({ label }: { label: string }): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={label}>
            <Play className="size-5" />
          </Button>
        </DropdownMenuTrigger>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function renderActionMenuItems(
  actions: ReadonlyArray<ViewportAction>,
  onInvokeAction: (action: ViewportAction) => void,
): ReadonlyArray<JSX.Element> {
  return actions.map((action) => (
    <DropdownMenuItem key={action.id} onSelect={() => onInvokeAction(action)}>
      {action.label}
    </DropdownMenuItem>
  ));
}

function describeApplyToSelected(selectedCount: number): string {
  if (selectedCount === 0) return "Apply to selected (none selected)";
  return `Apply to selected (${selectedCount})`;
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
