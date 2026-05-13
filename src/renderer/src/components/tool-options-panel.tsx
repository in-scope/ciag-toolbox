import { useEffect, useId, useMemo, useState } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ParameterFormSection } from "@/components/parameter-form-section";
import {
  buildDefaultParameterValuesForSchemas,
  type ParameterSchema,
  type ParameterValue,
  type ParameterValuesById,
} from "@/lib/actions/parameter-schema";
import type { RegisteredViewportAction } from "@/lib/actions/registered-actions";
import {
  DEFAULT_APPLY_SCOPE,
  type ApplyScope,
} from "@/lib/actions/viewport-action";

export interface ToolOptionsApplyOptions {
  readonly openInNewViewport: boolean;
  readonly parameterValues: ParameterValuesById;
  readonly applyScope: ApplyScope;
}

export interface ToolOptionsSourceViewport {
  readonly viewportNumber: number;
  readonly fileName: string;
  readonly hasRoi: boolean;
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
  const [applyScope, setApplyScope] = useState<ApplyScope>(DEFAULT_APPLY_SCOPE);
  const parameterSchemas = useStableParameterSchemas(props.action.parameters);
  const [parameterValues, setParameterValues] = useState<ParameterValuesById>(() =>
    buildDefaultParameterValuesForSchemas(parameterSchemas),
  );
  useResetPanelStateWhenActionChanges(
    props.action.id,
    parameterSchemas,
    setOpenInNewViewport,
    setParameterValues,
    setApplyScope,
  );
  useResetApplyScopeWhenRegionDisappears(props.sourceViewport, setApplyScope);
  const showApplyScopeSelector = shouldShowApplyScopeSelector(props.action, props.sourceViewport);
  const handleApply = () =>
    props.onApply({
      openInNewViewport,
      parameterValues,
      applyScope: showApplyScopeSelector ? applyScope : DEFAULT_APPLY_SCOPE,
    });
  return (
    <aside aria-label={`${props.action.label} options`} className={PANEL_CLASSES}>
      <ToolOptionsPanelHeader actionLabel={props.action.label} onCancel={props.onCancel} />
      <ToolOptionsPanelBody
        sourceViewport={props.sourceViewport}
        parameterSchemas={parameterSchemas}
        parameterValues={parameterValues}
        onChangeParameterValue={(id, next) =>
          setParameterValues((previous) => withParameterValueAtId(previous, id, next))
        }
        showApplyScopeSelector={showApplyScopeSelector}
        applyScope={applyScope}
        onChangeApplyScope={setApplyScope}
      />
      <ToolOptionsPanelFooter
        openInNewViewport={openInNewViewport}
        onChangeOpenInNewViewport={setOpenInNewViewport}
        onCancel={props.onCancel}
        onApply={handleApply}
        canApply={props.sourceViewport !== null}
      />
    </aside>
  );
}

function shouldShowApplyScopeSelector(
  action: RegisteredViewportAction,
  sourceViewport: ToolOptionsSourceViewport | null,
): boolean {
  if (!action.supportsRoiScope) return false;
  if (!sourceViewport) return false;
  return sourceViewport.hasRoi;
}

const PANEL_CLASSES =
  "flex w-[300px] shrink-0 flex-col border-l bg-card";

function useStableParameterSchemas(
  parameters: ReadonlyArray<ParameterSchema> | undefined,
): ReadonlyArray<ParameterSchema> {
  return useMemo(() => parameters ?? [], [parameters]);
}

function useResetPanelStateWhenActionChanges(
  actionId: string,
  parameterSchemas: ReadonlyArray<ParameterSchema>,
  setOpenInNewViewport: (value: boolean) => void,
  setParameterValues: (values: ParameterValuesById) => void,
  setApplyScope: (scope: ApplyScope) => void,
): void {
  useEffect(() => {
    setOpenInNewViewport(true);
    setParameterValues(buildDefaultParameterValuesForSchemas(parameterSchemas));
    setApplyScope(DEFAULT_APPLY_SCOPE);
  }, [actionId, parameterSchemas, setOpenInNewViewport, setParameterValues, setApplyScope]);
}

function useResetApplyScopeWhenRegionDisappears(
  sourceViewport: ToolOptionsSourceViewport | null,
  setApplyScope: (scope: ApplyScope) => void,
): void {
  const hasRoi = sourceViewport?.hasRoi ?? false;
  useEffect(() => {
    if (!hasRoi) setApplyScope(DEFAULT_APPLY_SCOPE);
  }, [hasRoi, setApplyScope]);
}

function withParameterValueAtId(
  previous: ParameterValuesById,
  id: string,
  next: ParameterValue,
): ParameterValuesById {
  return Object.freeze({ ...previous, [id]: next });
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
  parameterSchemas: ReadonlyArray<ParameterSchema>;
  parameterValues: ParameterValuesById;
  onChangeParameterValue: (id: string, next: ParameterValue) => void;
  showApplyScopeSelector: boolean;
  applyScope: ApplyScope;
  onChangeApplyScope: (next: ApplyScope) => void;
}

function ToolOptionsPanelBody(props: PanelBodyProps): JSX.Element {
  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
      <SourceViewportSection sourceViewport={props.sourceViewport} />
      {props.parameterSchemas.length > 0 ? (
        <ParameterFormSection
          schemas={props.parameterSchemas}
          values={props.parameterValues}
          onChangeValue={props.onChangeParameterValue}
        />
      ) : null}
      {props.showApplyScopeSelector ? (
        <ApplyScopeSelectorSection
          applyScope={props.applyScope}
          onChangeApplyScope={props.onChangeApplyScope}
        />
      ) : null}
    </div>
  );
}

function SourceViewportSection({
  sourceViewport,
}: {
  sourceViewport: ToolOptionsSourceViewport | null;
}): JSX.Element {
  if (!sourceViewport) return <SourceViewportEmptyState />;
  return <SourceViewportDescription sourceViewport={sourceViewport} />;
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

interface ApplyScopeSelectorSectionProps {
  applyScope: ApplyScope;
  onChangeApplyScope: (next: ApplyScope) => void;
}

function ApplyScopeSelectorSection(props: ApplyScopeSelectorSectionProps): JSX.Element {
  const radioGroupName = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-xs font-medium text-muted-foreground">Apply to</legend>
      <ApplyScopeRadioRow
        radioGroupName={radioGroupName}
        scope="whole-image"
        label="Whole image"
        currentScope={props.applyScope}
        onSelect={props.onChangeApplyScope}
      />
      <ApplyScopeRadioRow
        radioGroupName={radioGroupName}
        scope="roi"
        label="Region of interest"
        currentScope={props.applyScope}
        onSelect={props.onChangeApplyScope}
      />
    </fieldset>
  );
}

interface ApplyScopeRadioRowProps {
  radioGroupName: string;
  scope: ApplyScope;
  label: string;
  currentScope: ApplyScope;
  onSelect: (scope: ApplyScope) => void;
}

function ApplyScopeRadioRow(props: ApplyScopeRadioRowProps): JSX.Element {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="radio"
        className="size-4 cursor-pointer accent-primary"
        name={props.radioGroupName}
        checked={props.currentScope === props.scope}
        onChange={() => props.onSelect(props.scope)}
      />
      <span>{props.label}</span>
    </label>
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
