import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { SquareDashedMousePointer, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ParameterFormSection } from "@/components/parameter-form-section";
import {
  buildDefaultParameterValuesForSchemas,
  describeBandScopeBlockingErrorOrNull,
  seedBandScopeBandRangeDefaults,
  type ParameterSchema,
  type ParameterValue,
  type ParameterValuesById,
} from "@/lib/actions/parameter-schema";
import type { RegisteredViewportAction } from "@/lib/actions/registered-actions";
import {
  DEFAULT_APPLY_SCOPE,
  DEFAULT_APPLY_SCOPE_OPTIONS,
  type ApplyScope,
  type ApplyScopeOption,
} from "@/lib/actions/viewport-action";
import {
  canonicalizeViewportRoiCorners,
  type ViewportRoi,
} from "@/lib/image/viewport-roi";
import type { ReferencePickerOption } from "@/lib/image/reference-token";

export interface ToolOptionsApplyOptions {
  readonly openInNewViewport: boolean;
  readonly parameterValues: ParameterValuesById;
  readonly applyScope: ApplyScope;
}

export interface ToolOptionsSourceViewport {
  readonly viewportNumber: number;
  readonly fileName: string;
  readonly operationRegion: ViewportRoi | null;
  readonly sourceBandCount: number | null;
  readonly selectedBandNumber: number;
}

interface ToolOptionsPanelProps {
  action: RegisteredViewportAction | null;
  sourceViewport: ToolOptionsSourceViewport | null;
  loadedReferenceCandidates?: ReadonlyArray<ReferencePickerOption>;
  onCancel: () => void;
  onApply: (options: ToolOptionsApplyOptions) => void;
  onParametersChange?: (values: ParameterValuesById) => void;
  onBeginRegionRequest?: () => void;
  onClearOperationRegion?: () => void;
  embeddedEditor?: ReactNode;
}

export function ToolOptionsPanel(props: ToolOptionsPanelProps): JSX.Element | null {
  if (!props.action) return null;
  return (
    <ToolOptionsPanelShell
      action={props.action}
      sourceViewport={props.sourceViewport}
      loadedReferenceCandidates={props.loadedReferenceCandidates}
      onCancel={props.onCancel}
      onApply={props.onApply}
      onParametersChange={props.onParametersChange}
      onBeginRegionRequest={props.onBeginRegionRequest}
      onClearOperationRegion={props.onClearOperationRegion}
      embeddedEditor={props.embeddedEditor}
    />
  );
}

interface ToolOptionsPanelShellProps {
  action: RegisteredViewportAction;
  sourceViewport: ToolOptionsSourceViewport | null;
  loadedReferenceCandidates?: ReadonlyArray<ReferencePickerOption>;
  onCancel: () => void;
  onApply: (options: ToolOptionsApplyOptions) => void;
  onParametersChange?: (values: ParameterValuesById) => void;
  onBeginRegionRequest?: () => void;
  onClearOperationRegion?: () => void;
  embeddedEditor?: ReactNode;
}

function ToolOptionsPanelShell(props: ToolOptionsPanelShellProps): JSX.Element {
  const [openInNewViewport, setOpenInNewViewport] = useState(true);
  const [applyScope, setApplyScope] = useState<ApplyScope>(DEFAULT_APPLY_SCOPE);
  const parameterSchemas = useStableParameterSchemas(props.action.parameters);
  const currentBandNumberRef = useLatestCurrentBandNumberRef(props.sourceViewport);
  const [parameterValues, setParameterValues] = useState<ParameterValuesById>(() =>
    buildInitialParameterValuesForPanel(parameterSchemas, currentBandNumberRef.current),
  );
  useResetPanelStateWhenActionChanges(
    props.action.id,
    parameterSchemas,
    currentBandNumberRef,
    setOpenInNewViewport,
    setParameterValues,
    setApplyScope,
  );
  useReportParameterValuesToParent(parameterValues, props.onParametersChange);
  const applyScopeOptions = useApplyScopeOptions(props.action, props.sourceViewport);
  const showApplyScopeSelector = shouldShowApplyScopeSelector(props.action, props.sourceViewport, applyScopeOptions);
  const effectiveApplyScope = showApplyScopeSelector
    ? clampApplyScopeToOptions(applyScope, applyScopeOptions)
    : DEFAULT_APPLY_SCOPE;
  const isRegionRequiredNow = doesActionRequireRegionNow(props.action, effectiveApplyScope);
  const operationRegion = props.sourceViewport?.operationRegion ?? null;
  const hasBlockingParameterError = hasBlockingBandScopeError(parameterSchemas, parameterValues, props.sourceViewport);
  const handleApply = () =>
    props.onApply({ openInNewViewport, parameterValues, applyScope: effectiveApplyScope });
  return (
    <aside aria-label={`${props.action.label} options`} className={PANEL_CLASSES}>
      <ToolOptionsPanelHeader actionLabel={props.action.label} onCancel={props.onCancel} />
      <ToolOptionsPanelBody
        sourceViewport={props.sourceViewport}
        loadedReferenceCandidates={props.loadedReferenceCandidates}
        embeddedEditor={props.embeddedEditor}
        parameterSchemas={parameterSchemas}
        parameterValues={parameterValues}
        onChangeParameterValue={(id, next) =>
          setParameterValues((previous) => withParameterValueAtId(previous, id, next))
        }
        showApplyScopeSelector={showApplyScopeSelector}
        applyScopeOptions={applyScopeOptions}
        applyScope={effectiveApplyScope}
        onChangeApplyScope={setApplyScope}
        showRegionPicker={isRegionRequiredNow}
        operationRegion={operationRegion}
        onBeginRegionRequest={props.onBeginRegionRequest}
        onClearOperationRegion={props.onClearOperationRegion}
      />
      <ToolOptionsPanelFooter
        openInNewViewport={openInNewViewport}
        onChangeOpenInNewViewport={setOpenInNewViewport}
        onCancel={props.onCancel}
        onApply={handleApply}
        canApply={computeWhetherApplyIsAllowed(
          props.sourceViewport,
          isRegionRequiredNow,
          operationRegion,
          hasBlockingParameterError,
        )}
      />
    </aside>
  );
}

function useApplyScopeOptions(
  action: RegisteredViewportAction,
  sourceViewport: ToolOptionsSourceViewport | null,
): ReadonlyArray<ApplyScopeOption> {
  const bandCount = sourceViewport?.sourceBandCount ?? null;
  return useMemo(
    () => action.resolveApplyScopeOptions?.(bandCount) ?? DEFAULT_APPLY_SCOPE_OPTIONS,
    [action, bandCount],
  );
}

function shouldShowApplyScopeSelector(
  action: RegisteredViewportAction,
  sourceViewport: ToolOptionsSourceViewport | null,
  applyScopeOptions: ReadonlyArray<ApplyScopeOption>,
): boolean {
  if (!action.supportsRoiScope) return false;
  if (sourceViewport === null) return false;
  return applyScopeOptions.length >= 2;
}

function clampApplyScopeToOptions(
  applyScope: ApplyScope,
  applyScopeOptions: ReadonlyArray<ApplyScopeOption>,
): ApplyScope {
  if (applyScopeOptions.some((option) => option.scope === applyScope)) return applyScope;
  return applyScopeOptions[0]?.scope ?? DEFAULT_APPLY_SCOPE;
}

function doesActionRequireRegionNow(
  action: RegisteredViewportAction,
  applyScope: ApplyScope,
): boolean {
  if (action.requiresOperationRegion) return true;
  return Boolean(action.supportsRoiScope) && applyScope === "roi";
}

function computeWhetherApplyIsAllowed(
  sourceViewport: ToolOptionsSourceViewport | null,
  isRegionRequiredNow: boolean,
  operationRegion: ViewportRoi | null,
  hasBlockingParameterError: boolean,
): boolean {
  if (sourceViewport === null) return false;
  if (isRegionRequiredNow && operationRegion === null) return false;
  return !hasBlockingParameterError;
}

function hasBlockingBandScopeError(
  parameterSchemas: ReadonlyArray<ParameterSchema>,
  parameterValues: ParameterValuesById,
  sourceViewport: ToolOptionsSourceViewport | null,
): boolean {
  const bandCount = sourceViewport?.sourceBandCount ?? null;
  return describeBandScopeBlockingErrorOrNull(parameterSchemas, parameterValues, bandCount) !== null;
}

const PANEL_CLASSES =
  "flex w-[300px] shrink-0 flex-col border-l bg-card";

function useStableParameterSchemas(
  parameters: ReadonlyArray<ParameterSchema> | undefined,
): ReadonlyArray<ParameterSchema> {
  return useMemo(() => parameters ?? [], [parameters]);
}

function useLatestCurrentBandNumberRef(
  sourceViewport: ToolOptionsSourceViewport | null,
): { readonly current: number } {
  const currentBandNumber = sourceViewport?.selectedBandNumber ?? 1;
  const ref = useRef(currentBandNumber);
  ref.current = currentBandNumber;
  return ref;
}

function buildInitialParameterValuesForPanel(
  parameterSchemas: ReadonlyArray<ParameterSchema>,
  currentBandNumber: number,
): ParameterValuesById {
  const defaults = buildDefaultParameterValuesForSchemas(parameterSchemas);
  return seedBandScopeBandRangeDefaults(parameterSchemas, defaults, currentBandNumber);
}

function useResetPanelStateWhenActionChanges(
  actionId: string,
  parameterSchemas: ReadonlyArray<ParameterSchema>,
  currentBandNumberRef: { readonly current: number },
  setOpenInNewViewport: (value: boolean) => void,
  setParameterValues: (values: ParameterValuesById) => void,
  setApplyScope: (scope: ApplyScope) => void,
): void {
  useEffect(() => {
    setOpenInNewViewport(true);
    setParameterValues(buildInitialParameterValuesForPanel(parameterSchemas, currentBandNumberRef.current));
    setApplyScope(DEFAULT_APPLY_SCOPE);
  }, [actionId, parameterSchemas, currentBandNumberRef, setOpenInNewViewport, setParameterValues, setApplyScope]);
}

function useReportParameterValuesToParent(
  parameterValues: ParameterValuesById,
  onParametersChange: ((values: ParameterValuesById) => void) | undefined,
): void {
  useEffect(() => {
    onParametersChange?.(parameterValues);
  }, [parameterValues, onParametersChange]);
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
  loadedReferenceCandidates?: ReadonlyArray<ReferencePickerOption>;
  embeddedEditor?: ReactNode;
  parameterSchemas: ReadonlyArray<ParameterSchema>;
  parameterValues: ParameterValuesById;
  onChangeParameterValue: (id: string, next: ParameterValue) => void;
  showApplyScopeSelector: boolean;
  applyScopeOptions: ReadonlyArray<ApplyScopeOption>;
  applyScope: ApplyScope;
  onChangeApplyScope: (next: ApplyScope) => void;
  showRegionPicker: boolean;
  operationRegion: ViewportRoi | null;
  onBeginRegionRequest?: () => void;
  onClearOperationRegion?: () => void;
}

function ToolOptionsPanelBody(props: PanelBodyProps): JSX.Element {
  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
      <SourceViewportSection sourceViewport={props.sourceViewport} />
      {props.embeddedEditor}
      {props.parameterSchemas.length > 0 ? (
        <ParameterFormSection
          schemas={props.parameterSchemas}
          values={props.parameterValues}
          sourceBandCount={props.sourceViewport?.sourceBandCount ?? null}
          loadedReferenceCandidates={props.loadedReferenceCandidates}
          onChangeValue={props.onChangeParameterValue}
        />
      ) : null}
      {props.showApplyScopeSelector ? (
        <ApplyScopeSelectorSection
          options={props.applyScopeOptions}
          applyScope={props.applyScope}
          onChangeApplyScope={props.onChangeApplyScope}
        />
      ) : null}
      {props.showRegionPicker ? (
        <OperationRegionPickerSection
          operationRegion={props.operationRegion}
          onBeginRegionRequest={props.onBeginRegionRequest}
          onClearOperationRegion={props.onClearOperationRegion}
        />
      ) : null}
    </div>
  );
}

interface OperationRegionPickerSectionProps {
  operationRegion: ViewportRoi | null;
  onBeginRegionRequest?: () => void;
  onClearOperationRegion?: () => void;
}

function OperationRegionPickerSection(props: OperationRegionPickerSectionProps): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">Operation region</span>
      <OperationRegionReadout operationRegion={props.operationRegion} />
      <OperationRegionPickerButtons
        hasRegion={props.operationRegion !== null}
        onBeginRegionRequest={props.onBeginRegionRequest}
        onClearOperationRegion={props.onClearOperationRegion}
      />
    </div>
  );
}

function OperationRegionReadout({
  operationRegion,
}: {
  operationRegion: ViewportRoi | null;
}): JSX.Element {
  if (!operationRegion) {
    return (
      <p className="text-xs text-muted-foreground">
        Select a region on the image for this operation.
      </p>
    );
  }
  const canonical = canonicalizeViewportRoiCorners(operationRegion);
  return (
    <p className="text-sm text-foreground">
      {`(${canonical.imagePixelX0}, ${canonical.imagePixelY0}) - (${canonical.imagePixelX1}, ${canonical.imagePixelY1})`}
    </p>
  );
}

interface OperationRegionPickerButtonsProps {
  hasRegion: boolean;
  onBeginRegionRequest?: () => void;
  onClearOperationRegion?: () => void;
}

function OperationRegionPickerButtons(props: OperationRegionPickerButtonsProps): JSX.Element {
  return (
    <div className="flex gap-2">
      <Button type="button" variant="outline" size="sm" onClick={props.onBeginRegionRequest}>
        <SquareDashedMousePointer className="size-4" />
        {props.hasRegion ? "Reselect region" : "Select region"}
      </Button>
      {props.hasRegion ? (
        <Button type="button" variant="ghost" size="sm" onClick={props.onClearOperationRegion}>
          Clear
        </Button>
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
      Select a panel with a loaded stack to apply this tool.
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
        Panel {sourceViewport.viewportNumber} ({sourceViewport.fileName})
      </span>
    </div>
  );
}

interface ApplyScopeSelectorSectionProps {
  options: ReadonlyArray<ApplyScopeOption>;
  applyScope: ApplyScope;
  onChangeApplyScope: (next: ApplyScope) => void;
}

function ApplyScopeSelectorSection(props: ApplyScopeSelectorSectionProps): JSX.Element {
  const radioGroupName = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-xs font-medium text-muted-foreground">Apply to</legend>
      {props.options.map((option) => (
        <ApplyScopeRadioRow
          key={option.scope}
          radioGroupName={radioGroupName}
          scope={option.scope}
          label={option.label}
          currentScope={props.applyScope}
          onSelect={props.onChangeApplyScope}
        />
      ))}
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
      <span>Open in a new panel</span>
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
