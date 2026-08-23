import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { SquareDashedMousePointer, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ResultDestinationControl } from "@/components/result-destination-control";
import { ParameterFormSection } from "@/components/parameter-form-section";
import {
  buildDefaultParameterValuesForSchemas,
  describeBlockingParameterErrorOrNull,
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
import {
  buildLoadedPanelReferenceToken,
  filterLoadedReferenceCandidatesByDimensions,
  type LoadedReferenceCandidate,
} from "@/lib/image/reference-token";
import { listMaskLayersQualifyingForL2 } from "@/lib/analysis/l2-minimization-qualification";
import type { MaskPanelState } from "@/lib/masks/mask-panel";

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
  readonly isTrueColorComposite: boolean;
  readonly sourceWidth: number | null;
  readonly sourceHeight: number | null;
  readonly maskPanelState: MaskPanelState | null;
}

interface ToolOptionsPanelProps {
  action: RegisteredViewportAction | null;
  sourceViewport: ToolOptionsSourceViewport | null;
  loadedReferenceCandidates?: ReadonlyArray<LoadedReferenceCandidate>;
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
  loadedReferenceCandidates?: ReadonlyArray<LoadedReferenceCandidate>;
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
  const hasBlockingParameterError = hasBlockingParameterValueError(
    parameterSchemas,
    parameterValues,
    props.sourceViewport,
    props.loadedReferenceCandidates ?? EMPTY_LOADED_REFERENCE_CANDIDATES,
  );
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
  const isTrueColorComposite = sourceViewport?.isTrueColorComposite ?? false;
  return useMemo(
    () => action.resolveApplyScopeOptions?.(bandCount, isTrueColorComposite) ?? DEFAULT_APPLY_SCOPE_OPTIONS,
    [action, bandCount, isTrueColorComposite],
  );
}

function shouldShowApplyScopeSelector(
  action: RegisteredViewportAction,
  sourceViewport: ToolOptionsSourceViewport | null,
  applyScopeOptions: ReadonlyArray<ApplyScopeOption>,
): boolean {
  if (!actionOffersAnApplyScopeChoice(action)) return false;
  if (sourceViewport === null) return false;
  return applyScopeOptions.length >= 2;
}

// CT-244: the tone curve keeps its Full image / Whole stack selector without any
// ROI scope, so offering custom scope options is enough to render the control.
function actionOffersAnApplyScopeChoice(action: RegisteredViewportAction): boolean {
  return Boolean(action.supportsRoiScope) || action.resolveApplyScopeOptions !== undefined;
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

const EMPTY_LOADED_REFERENCE_CANDIDATES: ReadonlyArray<LoadedReferenceCandidate> = [];

// CT-300: a restricted raster-reference picker must never offer the active
// panel as its own second stack.
function resolveSourceOwnLoadedPanelTokenOrNull(
  sourceViewport: ToolOptionsSourceViewport | null,
): string | null {
  if (sourceViewport === null) return null;
  return buildLoadedPanelReferenceToken(sourceViewport.viewportNumber, sourceViewport.fileName);
}

function hasBlockingParameterValueError(
  parameterSchemas: ReadonlyArray<ParameterSchema>,
  parameterValues: ParameterValuesById,
  sourceViewport: ToolOptionsSourceViewport | null,
  loadedReferenceCandidates: ReadonlyArray<LoadedReferenceCandidate>,
): boolean {
  const bandCount = sourceViewport?.sourceBandCount ?? null;
  const qualifyingCounts = buildQualifyingReferenceCandidateCountsById(
    parameterSchemas,
    loadedReferenceCandidates,
    sourceViewport,
  );
  const qualifyingMaskLayerCounts = buildQualifyingMaskLayerCountsById(
    parameterSchemas,
    sourceViewport?.maskPanelState ?? null,
  );
  return (
    describeBlockingParameterErrorOrNull(
      parameterSchemas,
      parameterValues,
      bandCount,
      qualifyingCounts,
      qualifyingMaskLayerCounts,
    ) !== null
  );
}

// CT-313: for each mask-layer field, count how many of the active panel's
// mask layers actually qualify (>= 2 painted categories) - mirrors
// buildQualifyingReferenceCandidateCountsById's shape for restricted
// raster-reference fields.
function buildQualifyingMaskLayerCountsById(
  parameterSchemas: ReadonlyArray<ParameterSchema>,
  maskPanelState: MaskPanelState | null,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  const qualifyingCount =
    maskPanelState === null ? 0 : listMaskLayersQualifyingForL2(maskPanelState).length;
  for (const schema of parameterSchemas) {
    if (schema.kind !== "mask-layer") continue;
    counts.set(schema.id, qualifyingCount);
  }
  return counts;
}

// CT-300: for each raster-reference field restricted to dimension-matching
// panels, count how many loaded candidates actually qualify.
function buildQualifyingReferenceCandidateCountsById(
  parameterSchemas: ReadonlyArray<ParameterSchema>,
  loadedReferenceCandidates: ReadonlyArray<LoadedReferenceCandidate>,
  sourceViewport: ToolOptionsSourceViewport | null,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  if (sourceViewport === null || sourceViewport.sourceWidth === null || sourceViewport.sourceHeight === null) {
    return counts;
  }
  const matching = filterLoadedReferenceCandidatesByDimensions(
    loadedReferenceCandidates,
    sourceViewport.sourceWidth,
    sourceViewport.sourceHeight,
    resolveSourceOwnLoadedPanelTokenOrNull(sourceViewport) ?? undefined,
  );
  for (const schema of parameterSchemas) {
    if (schema.kind !== "raster-reference" || !schema.restrictToLoadedPanelsMatchingSourceDimensions) continue;
    counts.set(schema.id, matching.length);
  }
  return counts;
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
  loadedReferenceCandidates?: ReadonlyArray<LoadedReferenceCandidate>;
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
          sourceIsTrueColorComposite={props.sourceViewport?.isTrueColorComposite ?? false}
          sourceWidth={props.sourceViewport?.sourceWidth ?? null}
          sourceHeight={props.sourceViewport?.sourceHeight ?? null}
          sourceOwnLoadedPanelToken={resolveSourceOwnLoadedPanelTokenOrNull(props.sourceViewport)}
          loadedReferenceCandidates={props.loadedReferenceCandidates}
          maskPanelState={props.sourceViewport?.maskPanelState ?? null}
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
      <ResultDestinationControl
        openInNewViewport={props.openInNewViewport}
        onChangeOpenInNewViewport={props.onChangeOpenInNewViewport}
      />
      <PanelFooterButtons
        canApply={props.canApply}
        onCancel={props.onCancel}
        onApply={props.onApply}
      />
    </div>
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
