import { useId, useState, type Dispatch, type SetStateAction } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";

import { PANEL_SELECT_CLASSES } from "@/components/form-control-classes";
import { PerBandScoreSection } from "@/components/per-band-score-section";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CNR_PANEL_ICON } from "@/lib/actions/operation-command-bindings";
import {
  describeCnrQualificationProblemOrNull,
  listMaskLayersQualifyingForCnr,
} from "@/lib/analysis/cnr-qualification";
import {
  formatCnrHistoryAppliedLabel,
  formatCnrScoreToSignificantFigures,
} from "@/lib/analysis/cnr-score-format";
import { listNonEmptyCategoryValuesInMaskLayer } from "@/lib/analysis/npc-qualification";
import { selectTopScoringBandRows } from "@/lib/analysis/per-band-score-presentation";
import { deriveCnrCategoryDefaultsOrNull } from "@/lib/analysis/rop-objective";
import {
  computeCnrScoresShowingPanelBusy,
  type CnrAnalysisOutcome,
} from "@/lib/analysis/run-cnr-analysis";
import { OPERATION_STOPPED_MESSAGE } from "@/lib/image/operation-stop";
import type { RasterImage } from "@/lib/image/raster-image";
import type { MaskLayer } from "@/lib/masks/mask-layer";
import type { MaskPanelState } from "@/lib/masks/mask-panel";
import { notifyError } from "@/lib/notifications/notify";
import { useBusyEntryRegistrar, type BusyEntryRegistrar } from "@/state/busy-state-context";

// CT-320: the CNR aside. It reads like the NPC aside on purpose - a per-band
// analysis that produces MEASUREMENTS, not a raster, so it has Compute instead
// of Apply and no result destination - but the user picks WHICH two categories
// are contrasted, and the y axis follows the data because CNR is unbounded.

export interface CnrPanelTarget {
  readonly viewportIndex: number;
  readonly viewportNumber: number;
  readonly raster: RasterImage;
  readonly masks: MaskPanelState;
}

export interface CnrOptionsPanelProps {
  readonly target: CnrPanelTarget | null;
  readonly onRecordScoreInHistory: (appliedLabel: string) => void;
  readonly onClose: () => void;
}

export function CnrOptionsPanel(props: CnrOptionsPanelProps): JSX.Element {
  return (
    <aside aria-label="CNR options" className={CNR_PANEL_CLASSES}>
      <CnrPanelHeader
        viewportNumber={props.target?.viewportNumber ?? null}
        onClose={props.onClose}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <CnrPanelBody
          target={props.target}
          onRecordScoreInHistory={props.onRecordScoreInHistory}
        />
      </div>
    </aside>
  );
}

const CNR_PANEL_CLASSES = "flex w-[300px] shrink-0 flex-col border-l bg-card";

interface CnrPanelHeaderProps {
  readonly viewportNumber: number | null;
  readonly onClose: () => void;
}

function CnrPanelHeader(props: CnrPanelHeaderProps): JSX.Element {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
        <CNR_PANEL_ICON className="size-4" aria-hidden="true" />
        CNR
      </span>
      <div className="flex items-center gap-2">
        {props.viewportNumber === null ? null : (
          <span className="text-xs text-muted-foreground">Panel {props.viewportNumber}</span>
        )}
        <CnrPanelCloseButton onClose={props.onClose} />
      </div>
    </div>
  );
}

function CnrPanelCloseButton({ onClose }: { readonly onClose: () => void }): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Close CNR options" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Close CNR options</TooltipContent>
    </Tooltip>
  );
}

interface CnrPanelBodyProps {
  readonly target: CnrPanelTarget | null;
  readonly onRecordScoreInHistory: (appliedLabel: string) => void;
}

function CnrPanelBody(props: CnrPanelBodyProps): JSX.Element {
  const form = useCnrComputeForm(props.target);
  const problem = describeCnrQualificationProblemOrNull(props.target?.masks ?? null);
  return (
    <>
      <CnrExplanation />
      {problem === null ? null : <p className="text-xs text-muted-foreground">{problem}</p>}
      <CnrMaskLayerPicker form={form} isDisabled={problem !== null} />
      <CnrCategoryPickers form={form} isDisabled={problem !== null} />
      <CnrComputeButton
        isDisabled={!canComputeCnrNow(form, problem)}
        isComputing={form.isComputing}
        onCompute={() => void form.compute(props.onRecordScoreInHistory)}
      />
      <CnrPerBandScores raster={props.target?.raster ?? null} scores={form.scores} />
    </>
  );
}

// Contrasting a category with itself is always zero over zero, so Compute waits
// until the two pickers disagree.
function canComputeCnrNow(form: CnrComputeFormApi, problem: string | null): boolean {
  if (problem !== null || form.isComputing) return false;
  if (form.selectedLayer === null) return false;
  return form.categories !== null;
}

function CnrExplanation(): JSX.Element {
  return (
    <p className="text-xs text-muted-foreground">
      Contrast-to-noise ratio, band by band: the mean of the text category minus
      the mean of the background category, divided by the background&apos;s
      standard deviation. Higher is better.
    </p>
  );
}

interface CnrFieldProps {
  readonly form: CnrComputeFormApi;
  readonly isDisabled: boolean;
}

function CnrMaskLayerPicker(props: CnrFieldProps): JSX.Element {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      <span className="text-foreground">Mask layer</span>
      <select
        id={id}
        aria-label="Mask layer"
        className={PANEL_SELECT_CLASSES}
        disabled={props.isDisabled}
        value={props.form.selectedLayer?.id ?? ""}
        onChange={(event) => props.form.selectLayer(event.target.value)}
      >
        <CnrMaskLayerOptions layers={props.form.qualifyingLayers} />
      </select>
    </label>
  );
}

function CnrMaskLayerOptions({
  layers,
}: {
  readonly layers: ReadonlyArray<MaskLayer>;
}): JSX.Element {
  if (layers.length === 0) return <option value="">No usable mask layer</option>;
  return (
    <>
      {layers.map((layer) => (
        <option key={layer.id} value={layer.id}>
          {layer.name}
        </option>
      ))}
    </>
  );
}

function CnrCategoryPickers(props: CnrFieldProps): JSX.Element {
  return (
    <>
      <CnrCategoryPicker
        label="Text category"
        value={props.form.textCategoryValue}
        layer={props.form.selectedLayer}
        isDisabled={props.isDisabled}
        onChoose={props.form.selectTextCategory}
      />
      <CnrCategoryPicker
        label="Background category"
        value={props.form.backgroundCategoryValue}
        layer={props.form.selectedLayer}
        isDisabled={props.isDisabled}
        onChoose={props.form.selectBackgroundCategory}
      />
    </>
  );
}

interface CnrCategoryPickerProps {
  readonly label: string;
  readonly value: number | null;
  readonly layer: MaskLayer | null;
  readonly isDisabled: boolean;
  readonly onChoose: (categoryValue: number) => void;
}

function CnrCategoryPicker(props: CnrCategoryPickerProps): JSX.Element {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      <span className="text-foreground">{props.label}</span>
      <select
        id={id}
        aria-label={props.label}
        className={PANEL_SELECT_CLASSES}
        disabled={props.isDisabled}
        value={props.value ?? ""}
        onChange={(event) => props.onChoose(Number(event.target.value))}
      >
        <CnrCategoryOptions layer={props.layer} />
      </select>
    </label>
  );
}

function CnrCategoryOptions({ layer }: { readonly layer: MaskLayer | null }): JSX.Element {
  if (layer === null) return <option value="">No usable mask layer</option>;
  return (
    <>
      {listNonEmptyCategoryValuesInMaskLayer(layer).map((categoryValue) => (
        <option key={categoryValue} value={categoryValue}>
          {nameCnrCategory(layer, categoryValue)}
        </option>
      ))}
    </>
  );
}

function nameCnrCategory(layer: MaskLayer, categoryValue: number): string {
  return layer.categories[categoryValue - 1]?.name ?? `Category ${categoryValue}`;
}

interface CnrComputeButtonProps {
  readonly isDisabled: boolean;
  readonly isComputing: boolean;
  readonly onCompute: () => void;
}

function CnrComputeButton(props: CnrComputeButtonProps): JSX.Element {
  return (
    <Button type="button" disabled={props.isDisabled} onClick={props.onCompute}>
      {props.isComputing ? "Computing..." : "Compute"}
    </Button>
  );
}

interface CnrPerBandScoresProps {
  readonly raster: RasterImage | null;
  readonly scores: ReadonlyArray<number> | null;
}

// No fixed value range: CNR is unbounded, so the plot scales to the run.
function CnrPerBandScores(props: CnrPerBandScoresProps): JSX.Element {
  return (
    <PerBandScoreSection
      scoreName={CNR_SCORE_NAME}
      raster={props.raster}
      scores={props.scores}
      formatScore={formatCnrScoreToSignificantFigures}
      notComputedText={NOT_COMPUTED_YET_TEXT}
    />
  );
}

const CNR_SCORE_NAME = "CNR";
const NOT_COMPUTED_YET_TEXT = "Not computed yet";

// The scores are stored WITH the raster they were measured on, so a stack that
// changed under the aside shows the not-computed state without an effect.
interface CnrComputedScores {
  readonly raster: RasterImage;
  readonly scores: ReadonlyArray<number>;
}

interface CnrComputeFormState {
  readonly chosenLayerId: string | null;
  readonly chosenTextCategory: number | null;
  readonly chosenBackgroundCategory: number | null;
  readonly computed: CnrComputedScores | null;
  readonly isComputing: boolean;
}

const INITIAL_CNR_COMPUTE_FORM_STATE: CnrComputeFormState = {
  chosenLayerId: null,
  chosenTextCategory: null,
  chosenBackgroundCategory: null,
  computed: null,
  isComputing: false,
};

interface CnrChosenCategories {
  readonly textCategoryValue: number;
  readonly backgroundCategoryValue: number;
}

interface CnrComputeFormApi {
  readonly qualifyingLayers: ReadonlyArray<MaskLayer>;
  readonly selectedLayer: MaskLayer | null;
  readonly textCategoryValue: number | null;
  readonly backgroundCategoryValue: number | null;
  // null whenever the two pickers name the same category, which CNR cannot score.
  readonly categories: CnrChosenCategories | null;
  readonly scores: ReadonlyArray<number> | null;
  readonly isComputing: boolean;
  readonly selectLayer: (layerId: string) => void;
  readonly selectTextCategory: (categoryValue: number) => void;
  readonly selectBackgroundCategory: (categoryValue: number) => void;
  readonly compute: (recordScore: RecordCnrScoreCallback) => Promise<void>;
}

type RecordCnrScoreCallback = (appliedLabel: string) => void;

function useCnrComputeForm(target: CnrPanelTarget | null): CnrComputeFormApi {
  const [state, setState] = useState<CnrComputeFormState>(INITIAL_CNR_COMPUTE_FORM_STATE);
  const busyRegistrar = useBusyEntryRegistrar();
  const qualifyingLayers = listQualifyingMaskLayersForTarget(target);
  const selectedLayer = pickSelectedCnrMaskLayer(qualifyingLayers, state.chosenLayerId, target);
  const chosen = resolveChosenCnrCategories(state, selectedLayer);
  return {
    ...buildCnrFormReadouts(state, qualifyingLayers, selectedLayer, chosen, target),
    selectLayer: (layerId) => setState(forgetScoresAndSet({ chosenLayerId: layerId })),
    selectTextCategory: (value) =>
      setState(forgetScoresAndSet({ chosenTextCategory: value })),
    selectBackgroundCategory: (value) =>
      setState(forgetScoresAndSet({ chosenBackgroundCategory: value })),
    compute: (recordScore) =>
      runCnrComputationForForm(
        { target, selectedLayer, categories: pairDistinctCategories(chosen), busyRegistrar },
        setState,
        recordScore,
      ),
  };
}

function forgetScoresAndSet(
  change: Partial<CnrComputeFormState>,
): (previous: CnrComputeFormState) => CnrComputeFormState {
  return (previous) => ({ ...previous, ...change, computed: null });
}

interface CnrCategoryReadouts {
  readonly textCategoryValue: number | null;
  readonly backgroundCategoryValue: number | null;
}

// An explicit picker choice wins while its category still has painted pixels;
// otherwise the ROP panel's defaults (categories 1 and 2, falling back to the
// first non-empty ones in index order) apply.
function resolveChosenCnrCategories(
  state: CnrComputeFormState,
  layer: MaskLayer | null,
): CnrCategoryReadouts {
  const defaults = deriveCnrCategoryDefaultsOrNull(layer);
  if (defaults === null) return { textCategoryValue: null, backgroundCategoryValue: null };
  const nonEmpty = layer ? listNonEmptyCategoryValuesInMaskLayer(layer) : [];
  return {
    textCategoryValue: pickChosenCategoryOrDefault(
      state.chosenTextCategory,
      nonEmpty,
      defaults.textCategoryValue,
    ),
    backgroundCategoryValue: pickChosenCategoryOrDefault(
      state.chosenBackgroundCategory,
      nonEmpty,
      defaults.backgroundCategoryValue,
    ),
  };
}

function pickChosenCategoryOrDefault(
  chosen: number | null,
  nonEmptyCategoryValues: ReadonlyArray<number>,
  defaultValue: number,
): number {
  if (chosen !== null && nonEmptyCategoryValues.includes(chosen)) return chosen;
  return defaultValue;
}

function pairDistinctCategories(readouts: CnrCategoryReadouts): CnrChosenCategories | null {
  const { textCategoryValue, backgroundCategoryValue } = readouts;
  if (textCategoryValue === null || backgroundCategoryValue === null) return null;
  if (textCategoryValue === backgroundCategoryValue) return null;
  return { textCategoryValue, backgroundCategoryValue };
}

function buildCnrFormReadouts(
  state: CnrComputeFormState,
  qualifyingLayers: ReadonlyArray<MaskLayer>,
  selectedLayer: MaskLayer | null,
  chosen: CnrCategoryReadouts,
  target: CnrPanelTarget | null,
): Omit<
  CnrComputeFormApi,
  "selectLayer" | "selectTextCategory" | "selectBackgroundCategory" | "compute"
> {
  return {
    qualifyingLayers,
    selectedLayer,
    textCategoryValue: chosen.textCategoryValue,
    backgroundCategoryValue: chosen.backgroundCategoryValue,
    categories: pairDistinctCategories(chosen),
    scores: readScoresMeasuredOnTargetOrNull(state.computed, target),
    isComputing: state.isComputing,
  };
}

function readScoresMeasuredOnTargetOrNull(
  computed: CnrComputedScores | null,
  target: CnrPanelTarget | null,
): ReadonlyArray<number> | null {
  if (computed === null || target === null) return null;
  return computed.raster === target.raster ? computed.scores : null;
}

function listQualifyingMaskLayersForTarget(
  target: CnrPanelTarget | null,
): ReadonlyArray<MaskLayer> {
  if (target === null) return EMPTY_MASK_LAYER_LIST;
  return listMaskLayersQualifyingForCnr(target.masks);
}

const EMPTY_MASK_LAYER_LIST: ReadonlyArray<MaskLayer> = Object.freeze([]);

// The picker defaults to the layer the Masks tool has selected (when it
// qualifies) and otherwise to the first usable one, so opening the panel needs
// no click in the common case. An explicit choice wins until it disappears.
function pickSelectedCnrMaskLayer(
  qualifyingLayers: ReadonlyArray<MaskLayer>,
  chosenLayerId: string | null,
  target: CnrPanelTarget | null,
): MaskLayer | null {
  return (
    findMaskLayerById(qualifyingLayers, chosenLayerId) ??
    findMaskLayerById(qualifyingLayers, target?.masks.selectedLayerId ?? null) ??
    qualifyingLayers[0] ??
    null
  );
}

function findMaskLayerById(
  layers: ReadonlyArray<MaskLayer>,
  layerId: string | null,
): MaskLayer | null {
  if (layerId === null) return null;
  return layers.find((layer) => layer.id === layerId) ?? null;
}

type CnrComputeFormStateWriter = Dispatch<SetStateAction<CnrComputeFormState>>;

interface CnrComputationInputs {
  readonly target: CnrPanelTarget | null;
  readonly selectedLayer: MaskLayer | null;
  readonly categories: CnrChosenCategories | null;
  readonly busyRegistrar: BusyEntryRegistrar;
}

async function runCnrComputationForForm(
  inputs: CnrComputationInputs,
  setState: CnrComputeFormStateWriter,
  recordScore: RecordCnrScoreCallback,
): Promise<void> {
  const { target, selectedLayer, categories } = inputs;
  if (target === null || selectedLayer === null || categories === null) return;
  // The plot and list return to "Not computed yet" for the duration of the run:
  // stale scores next to a running analysis read as this run's answer.
  setState(forgetScoresAndSet({ isComputing: true }));
  try {
    const outcome = await computeCnrScoresForTarget(inputs, target, selectedLayer, categories);
    const run = describeCompletedCnrRun(target, selectedLayer, categories);
    reportCnrOutcome(outcome, run, { setState, recordScore });
  } finally {
    setState((previous) => ({ ...previous, isComputing: false }));
  }
}

function computeCnrScoresForTarget(
  inputs: CnrComputationInputs,
  target: CnrPanelTarget,
  maskLayer: MaskLayer,
  categories: CnrChosenCategories,
): Promise<CnrAnalysisOutcome> {
  return computeCnrScoresShowingPanelBusy(
    { raster: target.raster, maskLayer, ...categories },
    {
      busyRegistrar: inputs.busyRegistrar,
      viewportIndex: target.viewportIndex,
      stopController: new AbortController(),
    },
  );
}

interface CnrOutcomeReporters {
  readonly setState: CnrComputeFormStateWriter;
  readonly recordScore: RecordCnrScoreCallback;
}

interface CnrCompletedRun {
  readonly raster: RasterImage;
  readonly maskLayerName: string;
  readonly textCategoryName: string;
  readonly backgroundCategoryName: string;
}

function describeCompletedCnrRun(
  target: CnrPanelTarget,
  maskLayer: MaskLayer,
  categories: CnrChosenCategories,
): CnrCompletedRun {
  return {
    raster: target.raster,
    maskLayerName: maskLayer.name,
    textCategoryName: nameCnrCategory(maskLayer, categories.textCategoryValue),
    backgroundCategoryName: nameCnrCategory(maskLayer, categories.backgroundCategoryValue),
  };
}

function reportCnrOutcome(
  outcome: CnrAnalysisOutcome,
  run: CnrCompletedRun,
  reporters: CnrOutcomeReporters,
): void {
  if (outcome.status === "stopped") {
    toast.info(OPERATION_STOPPED_MESSAGE);
    return;
  }
  if (outcome.status === "failed") {
    notifyError(outcome.message);
    return;
  }
  reporters.setState((previous) => ({
    ...previous,
    computed: { raster: run.raster, scores: outcome.scores },
  }));
  recordCnrTopBandsInHistory(outcome.scores, run, reporters.recordScore);
}

// History names the same rows the panel lists, in the same order.
function recordCnrTopBandsInHistory(
  scores: ReadonlyArray<number>,
  run: CnrCompletedRun,
  recordScore: RecordCnrScoreCallback,
): void {
  const topBandRows = selectTopScoringBandRows(run.raster, scores);
  if (topBandRows.length === 0) return;
  recordScore(formatCnrHistoryAppliedLabel(run, topBandRows));
}
