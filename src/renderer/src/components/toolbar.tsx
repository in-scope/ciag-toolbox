import type { ReactNode } from "react";
import { BoxSelect, FolderOpen, Grid2x2 } from "lucide-react";

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

interface ToolbarProps {
  onOpenImage: () => void;
  gridLayout: GridLayout;
  onGridLayoutChange: (layout: GridLayout) => void;
  registeredActions: ReadonlyArray<RegisteredViewportAction>;
  onInvokeAction: (action: RegisteredViewportAction) => void;
  getActionAvailability: GetActionAvailabilityForActiveViewport;
  isRegionToolActive: boolean;
  onToggleRegionTool: () => void;
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
        <ToolbarSeparator />
        <RegionToolToggleButton
          isRegionToolActive={props.isRegionToolActive}
          onToggleRegionTool={props.onToggleRegionTool}
        />
        <ToolbarSeparator />
        <RegisteredActionButtons
          registeredActions={props.registeredActions}
          onInvokeAction={props.onInvokeAction}
          getActionAvailability={props.getActionAvailability}
        />
      </div>
    </TooltipProvider>
  );
}

interface RegionToolToggleButtonProps {
  readonly isRegionToolActive: boolean;
  readonly onToggleRegionTool: () => void;
}

function RegionToolToggleButton(props: RegionToolToggleButtonProps): JSX.Element {
  const label = props.isRegionToolActive
    ? "Select Region (active)"
    : "Select Region";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-pressed={props.isRegionToolActive}
          className={cn(
            props.isRegionToolActive &&
              "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary",
          )}
          onClick={props.onToggleRegionTool}
        >
          <BoxSelect className="size-5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
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

function ToolbarSeparator(): JSX.Element {
  return (
    <div role="separator" aria-orientation="vertical" className="mx-1 h-6 w-px bg-border" />
  );
}

interface RegisteredActionButtonsProps {
  registeredActions: ReadonlyArray<RegisteredViewportAction>;
  onInvokeAction: (action: RegisteredViewportAction) => void;
  getActionAvailability: GetActionAvailabilityForActiveViewport;
}

function RegisteredActionButtons(props: RegisteredActionButtonsProps): JSX.Element {
  return (
    <>
      {props.registeredActions.map((action) => (
        <ActionToolbarButton
          key={action.id}
          action={action}
          availability={props.getActionAvailability(action)}
          onInvoke={() => props.onInvokeAction(action)}
        />
      ))}
    </>
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
  return `${actionLabel} (select a viewport with a loaded image)`;
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
