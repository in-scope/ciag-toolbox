import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { RegisteredViewportAction } from "@/lib/actions/registered-actions";

export interface ToolOptionsApplyOptions {
  readonly openInNewViewport: boolean;
}

export interface ToolOptionsSourceViewport {
  readonly viewportNumber: number;
  readonly fileName: string;
}

interface ToolOptionsPanelProps {
  action: RegisteredViewportAction | null;
  sourceViewport: ToolOptionsSourceViewport | null;
  onCancel: () => void;
  onApply: (options: ToolOptionsApplyOptions) => void;
}

export function ToolOptionsPanel(props: ToolOptionsPanelProps): JSX.Element | null {
  if (!props.action) return null;
  return (
    <ToolOptionsPanelShell
      action={props.action}
      sourceViewport={props.sourceViewport}
      onCancel={props.onCancel}
      onApply={props.onApply}
    />
  );
}

interface ToolOptionsPanelShellProps {
  action: RegisteredViewportAction;
  sourceViewport: ToolOptionsSourceViewport | null;
  onCancel: () => void;
  onApply: (options: ToolOptionsApplyOptions) => void;
}

function ToolOptionsPanelShell(props: ToolOptionsPanelShellProps): JSX.Element {
  const [openInNewViewport, setOpenInNewViewport] = useState(true);
  useResetOpenInNewViewportWhenActionChanges(props.action.id, setOpenInNewViewport);
  const canApply = props.sourceViewport !== null;
  const handleApply = () => props.onApply({ openInNewViewport });
  return (
    <TooltipProvider delayDuration={300}>
      <aside aria-label={`${props.action.label} options`} className={PANEL_CLASSES}>
        <ToolOptionsPanelHeader actionLabel={props.action.label} onCancel={props.onCancel} />
        <ToolOptionsPanelBody sourceViewport={props.sourceViewport} />
        <ToolOptionsPanelFooter
          openInNewViewport={openInNewViewport}
          onChangeOpenInNewViewport={setOpenInNewViewport}
          onCancel={props.onCancel}
          onApply={handleApply}
          canApply={canApply}
        />
      </aside>
    </TooltipProvider>
  );
}

const PANEL_CLASSES =
  "flex w-[300px] shrink-0 flex-col border-l bg-card";

function useResetOpenInNewViewportWhenActionChanges(
  actionId: string,
  setOpenInNewViewport: (value: boolean) => void,
): void {
  useEffect(() => setOpenInNewViewport(true), [actionId, setOpenInNewViewport]);
}

interface PanelHeaderProps {
  actionLabel: string;
  onCancel: () => void;
}

function ToolOptionsPanelHeader(props: PanelHeaderProps): JSX.Element {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
      <span className="text-sm font-medium text-foreground">{props.actionLabel}</span>
      <PanelCloseButton onCancel={props.onCancel} />
    </div>
  );
}

function PanelCloseButton({ onCancel }: { onCancel: () => void }): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Close panel" onClick={onCancel}>
          <X className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Close panel</TooltipContent>
    </Tooltip>
  );
}

interface PanelBodyProps {
  sourceViewport: ToolOptionsSourceViewport | null;
}

function ToolOptionsPanelBody(props: PanelBodyProps): JSX.Element {
  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
      <SourceViewportSection sourceViewport={props.sourceViewport} />
    </div>
  );
}

function SourceViewportSection(props: PanelBodyProps): JSX.Element {
  if (!props.sourceViewport) return <SourceViewportEmptyState />;
  return <SourceViewportDescription sourceViewport={props.sourceViewport} />;
}

function SourceViewportEmptyState(): JSX.Element {
  return (
    <p className="text-xs text-muted-foreground">
      Select a viewport with a loaded image to apply this tool.
    </p>
  );
}

function SourceViewportDescription({
  sourceViewport,
}: {
  sourceViewport: ToolOptionsSourceViewport;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">Source</span>
      <span className="truncate text-sm text-foreground" title={sourceViewport.fileName}>
        Viewport {sourceViewport.viewportNumber} ({sourceViewport.fileName})
      </span>
    </div>
  );
}

interface PanelFooterProps {
  openInNewViewport: boolean;
  onChangeOpenInNewViewport: (next: boolean) => void;
  onCancel: () => void;
  onApply: () => void;
  canApply: boolean;
}

function ToolOptionsPanelFooter(props: PanelFooterProps): JSX.Element {
  return (
    <div className="flex flex-col gap-3 border-t p-3">
      <OpenInNewViewportSwitchRow
        checked={props.openInNewViewport}
        onCheckedChange={props.onChangeOpenInNewViewport}
      />
      <PanelFooterButtons
        canApply={props.canApply}
        onCancel={props.onCancel}
        onApply={props.onApply}
      />
    </div>
  );
}

interface SwitchRowProps {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
}

function OpenInNewViewportSwitchRow(props: SwitchRowProps): JSX.Element {
  const id = "tool-options-open-in-new-viewport";
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-3 text-sm">
      <span>Open in a new viewport</span>
      <Switch id={id} checked={props.checked} onCheckedChange={props.onCheckedChange} />
    </label>
  );
}

interface PanelFooterButtonsProps {
  canApply: boolean;
  onCancel: () => void;
  onApply: () => void;
}

function PanelFooterButtons(props: PanelFooterButtonsProps): JSX.Element {
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="ghost" onClick={props.onCancel}>
        Cancel
      </Button>
      <Button type="button" disabled={!props.canApply} onClick={props.onApply}>
        Apply
      </Button>
    </div>
  );
}
