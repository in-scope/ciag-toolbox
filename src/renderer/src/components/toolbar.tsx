import type { ReactNode } from "react";
import { FolderOpen, Grid2x2, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type GridLayout = "1x1" | "1x2" | "2x1" | "2x2" | "2x3" | "3x2";

const SELECTABLE_GRID_LAYOUTS: ReadonlyArray<GridLayout> = [
  "1x1",
  "1x2",
  "2x1",
  "2x2",
  "2x3",
  "3x2",
];

interface ToolbarProps {
  onOpenImage: () => void;
  gridLayout: GridLayout;
  onGridLayoutChange: (layout: GridLayout) => void;
  selectedViewportCount: number;
  onApplyToSelected: () => void;
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
        <ApplyToSelectedButton
          selectedCount={props.selectedViewportCount}
          onApplyToSelected={props.onApplyToSelected}
        />
      </div>
    </TooltipProvider>
  );
}

const TOOLBAR_CLASSES =
  "flex w-full flex-wrap items-center gap-2 border-b bg-card px-2 py-1.5";

function OpenImageButton({
  onOpenImage,
}: {
  onOpenImage: () => void;
}): JSX.Element {
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

interface ApplyToSelectedButtonProps {
  selectedCount: number;
  onApplyToSelected: () => void;
}

function ApplyToSelectedButton(props: ApplyToSelectedButtonProps): JSX.Element {
  const label = describeApplyToSelected(props.selectedCount);
  return (
    <IconButtonWithTooltip
      label={label}
      onClick={props.onApplyToSelected}
      disabled={props.selectedCount === 0}
    >
      <Play className="size-5" />
    </IconButtonWithTooltip>
  );
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
