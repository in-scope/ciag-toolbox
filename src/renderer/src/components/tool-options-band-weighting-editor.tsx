import {
  useCallback,
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { toast } from "sonner";

import { ScriptDocsLink } from "@/components/script-docs-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { validateBandWeightVectorReturnValue } from "@/lib/image/band-ops/user-script-return-contract";
import type { RasterImage } from "@/lib/image/raster-image";
import { buildUserScriptCubeFromRaster } from "@/lib/python/user-script-cube";
import { useViewportRendering } from "@/state/viewport-rendering-context";

// CT-209: the per-band weight editor embedded in the Band Weighting operation
// panel. The live weights ride in ViewportRenderingState.bandWeights (the same
// editor-owned pattern as the threshold bounds), so the weight fields, the
// reset helpers, a formula/imported-tool result, and Apply all read one source
// of truth. A formula or imported tool runs through the CT-208 scripting worker
// and its returned weight vector just fills the same editable fields.

const DEFAULT_BAND_WEIGHT = 1;

interface ToolOptionsBandWeightingEditorProps {
  viewportIndex: number;
  raster: RasterImage;
}

export function ToolOptionsBandWeightingEditor(
  props: ToolOptionsBandWeightingEditorProps,
): JSX.Element {
  const binding = useBandWeightsBinding(props.viewportIndex, props.raster.bandCount);
  const runner = useRunUserScriptForWeights(props.raster, binding.setWeights);
  useInitializeBandWeightsWhenAbsent(props.raster.bandCount, binding);
  if (!binding.weights) return <BandWeightingEditorLoading />;
  return (
    <LoadedBandWeightingEditor
      raster={props.raster}
      weights={binding.weights}
      setWeights={binding.setWeights}
      runner={runner}
    />
  );
}

interface BandWeightsBinding {
  weights: ReadonlyArray<number> | null;
  setWeights: (next: ReadonlyArray<number>) => void;
}

function useBandWeightsBinding(viewportIndex: number, bandCount: number): BandWeightsBinding {
  const renderingApi = useViewportRendering();
  const stored = renderingApi.getRenderingState(viewportIndex).bandWeights;
  const setWeights = useCallback(
    (next: ReadonlyArray<number>) => {
      const current = renderingApi.getRenderingState(viewportIndex);
      renderingApi.setRenderingState(viewportIndex, { ...current, bandWeights: [...next] });
    },
    [renderingApi, viewportIndex],
  );
  return { weights: readWeightsMatchingBandCount(stored, bandCount), setWeights };
}

function useInitializeBandWeightsWhenAbsent(bandCount: number, binding: BandWeightsBinding): void {
  const hasWeights = binding.weights !== null;
  const { setWeights } = binding;
  useEffect(() => {
    if (hasWeights) return;
    setWeights(makeUniformWeightVector(bandCount, DEFAULT_BAND_WEIGHT));
  }, [hasWeights, bandCount, setWeights]);
}

interface UserScriptWeightsRunner {
  isRunning: boolean;
  runFormula: (expression: string) => void;
  runImport: () => void;
}

function useRunUserScriptForWeights(
  raster: RasterImage,
  setWeights: (next: ReadonlyArray<number>) => void,
): UserScriptWeightsRunner {
  const [isRunning, setIsRunning] = useState(false);
  const run = useCallback(
    (source: ToolboxRunUserScriptSource) => {
      void executeUserScriptForWeights(raster, source, setWeights, setIsRunning);
    },
    [raster, setWeights],
  );
  return {
    isRunning,
    runFormula: (expression) => run({ mode: "formula", expression }),
    runImport: () => run({ mode: "import" }),
  };
}

async function executeUserScriptForWeights(
  raster: RasterImage,
  source: ToolboxRunUserScriptSource,
  setWeights: (next: ReadonlyArray<number>) => void,
  setIsRunning: (next: boolean) => void,
): Promise<void> {
  setIsRunning(true);
  try {
    const result = await runUserScriptForCube(raster, source);
    applyUserScriptWeightsResult(result, raster.bandCount, setWeights);
  } catch (error) {
    toast.error(describeWeightsScriptError(error));
  } finally {
    setIsRunning(false);
  }
}

function runUserScriptForCube(
  raster: RasterImage,
  source: ToolboxRunUserScriptSource,
): Promise<ToolboxRunUserScriptResult> {
  return window.toolboxApi.runUserScript({ cube: buildUserScriptCubeFromRaster(raster), source });
}

function applyUserScriptWeightsResult(
  result: ToolboxRunUserScriptResult,
  bandCount: number,
  setWeights: (next: ReadonlyArray<number>) => void,
): void {
  if (result.status === "canceled") return;
  if (result.status === "failed") throw new Error(result.message);
  // This editor always requests resultKind "value", so a cube result is a harness bug.
  if (result.status !== "completed") throw new Error("The script returned an unexpected result.");
  setWeights(validateBandWeightVectorReturnValue(result.value, bandCount));
}

function describeWeightsScriptError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface LoadedBandWeightingEditorProps {
  raster: RasterImage;
  weights: ReadonlyArray<number>;
  setWeights: (next: ReadonlyArray<number>) => void;
  runner: UserScriptWeightsRunner;
}

function LoadedBandWeightingEditor(props: LoadedBandWeightingEditorProps): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs font-medium text-muted-foreground">Band weights</span>
      <BandWeightResetButtons
        bandCount={props.raster.bandCount}
        setWeights={props.setWeights}
        disabled={props.runner.isRunning}
      />
      <BandWeightFields weights={props.weights} setWeights={props.setWeights} />
      <BandWeightingScriptControls runner={props.runner} />
      <p className="text-xs text-muted-foreground">
        Weights combine the bands into one image, normalized by the sum of their absolute values.
        Set them by hand, run a formula, or import a tool; the result fills the fields so you can
        tweak before Apply. The stack changes only on Apply.
      </p>
    </div>
  );
}

interface BandWeightResetButtonsProps {
  bandCount: number;
  setWeights: (next: ReadonlyArray<number>) => void;
  disabled: boolean;
}

function BandWeightResetButtons(props: BandWeightResetButtonsProps): JSX.Element {
  return (
    <div className="flex gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={props.disabled}
        onClick={() => props.setWeights(makeUniformWeightVector(props.bandCount, 0))}
      >
        Set all weights to 0
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={props.disabled}
        onClick={() => props.setWeights(makeUniformWeightVector(props.bandCount, 1))}
      >
        Set all weights to 1
      </Button>
    </div>
  );
}

interface BandWeightFieldsProps {
  weights: ReadonlyArray<number>;
  setWeights: (next: ReadonlyArray<number>) => void;
}

function BandWeightFields(props: BandWeightFieldsProps): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      {props.weights.map((weight, index) => (
        <BandWeightField
          key={index}
          index={index}
          value={weight}
          onCommitValue={(next) => props.setWeights(setWeightAtIndex(props.weights, index, next))}
        />
      ))}
    </div>
  );
}

interface BandWeightFieldProps {
  index: number;
  value: number;
  onCommitValue: (value: number) => void;
}

function BandWeightField(props: BandWeightFieldProps): JSX.Element {
  const formatted = formatWeightFieldValue(props.value);
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => commitWeightField(draft ?? formatted, props.onCommitValue, setDraft);
  return (
    <label className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
      <span>Band {props.index + 1}</span>
      <Input
        aria-label={`Weight for band ${props.index + 1}`}
        inputMode="decimal"
        value={draft ?? formatted}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => commitWeightFieldOnEnter(event, commit)}
        className="h-8 w-24 text-center text-foreground"
      />
    </label>
  );
}

interface BandWeightingScriptControlsProps {
  runner: UserScriptWeightsRunner;
}

function BandWeightingScriptControls(props: BandWeightingScriptControlsProps): JSX.Element {
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-2">
      <BandWeightingFormulaField runner={props.runner} />
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={props.runner.isRunning}
          onClick={props.runner.runImport}
        >
          Import script...
        </Button>
        <ScriptDocsLink />
      </div>
    </div>
  );
}

function BandWeightingFormulaField(props: BandWeightingScriptControlsProps): JSX.Element {
  const [expression, setExpression] = useState("");
  const runFormula = () => runFormulaIfPresent(expression, props.runner);
  return (
    <div className="flex items-end gap-2">
      <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
        Formula
        <Input
          aria-label="Weight formula"
          placeholder="e.g. cube.mean(axis=(1,2))"
          value={expression}
          onChange={(event) => setExpression(event.target.value)}
          onKeyDown={(event) => runFormulaOnEnter(event, runFormula)}
          className="h-8 text-foreground"
        />
      </label>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={props.runner.isRunning || expression.trim() === ""}
        onClick={runFormula}
      >
        Run formula
      </Button>
    </div>
  );
}

function BandWeightingEditorLoading(): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">Band weights</span>
      <p className="text-xs text-muted-foreground">Preparing weights...</p>
    </div>
  );
}

function runFormulaIfPresent(expression: string, runner: UserScriptWeightsRunner): void {
  const trimmed = expression.trim();
  if (trimmed === "" || runner.isRunning) return;
  runner.runFormula(trimmed);
}

function runFormulaOnEnter(
  event: ReactKeyboardEvent<HTMLInputElement>,
  runFormula: () => void,
): void {
  if (event.key !== "Enter") return;
  event.preventDefault();
  runFormula();
}

function commitWeightField(
  text: string,
  onCommitValue: (value: number) => void,
  setDraft: (text: string | null) => void,
): void {
  const parsed = parseWeightFieldValueOrNull(text);
  if (parsed !== null) onCommitValue(parsed);
  setDraft(null);
}

function commitWeightFieldOnEnter(
  event: ReactKeyboardEvent<HTMLInputElement>,
  commit: () => void,
): void {
  if (event.key !== "Enter") return;
  event.preventDefault();
  commit();
}

function formatWeightFieldValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

function parseWeightFieldValueOrNull(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function makeUniformWeightVector(bandCount: number, value: number): number[] {
  return Array.from({ length: bandCount }, () => value);
}

function setWeightAtIndex(
  weights: ReadonlyArray<number>,
  index: number,
  value: number,
): number[] {
  return weights.map((weight, weightIndex) => (weightIndex === index ? value : weight));
}

function readWeightsMatchingBandCount(
  stored: ReadonlyArray<number> | null,
  bandCount: number,
): ReadonlyArray<number> | null {
  if (!stored || stored.length !== bandCount) return null;
  return stored;
}
