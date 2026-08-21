import {
  useCallback,
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { notifyError } from "@/lib/notifications/notify";

import { ScriptDocsLink } from "@/components/script-docs-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BandSelectionEditingState, BandSelectionPreset } from "@/lib/image/band-ops/band-selection";
import {
  BAND_SELECTION_PRESET_LABELS,
  describeBandSelectionFunction,
  describeImportedToolBandSelection,
  flattenBandMatrixToFloat32,
  FORMULA_BAND_SELECTION_DESCRIPTION,
} from "@/lib/image/band-ops/band-selection-editing";
import { rememberBandSelectionResult } from "@/lib/image/band-ops/band-selection-result-store";
import { validateBandSelectionReturnValue } from "@/lib/image/band-ops/user-script-return-contract";
import type { RasterImage } from "@/lib/image/raster-image";
import {
  runUserScriptOnRasterShowingViewportBusy,
  type UserScriptRunFlowBindings,
} from "@/lib/python/run-user-script-flow";
import { useBusyEntryRegistrar } from "@/state/busy-state-context";
import { useViewportRendering } from "@/state/viewport-rendering-context";

// CT-210: the band-selection controls (preset picker, formula field, import
// button). CT-284 rehoused them from the Band Selection operation panel into the
// Subset Bands editor's "By function" mode; the machinery is unchanged. The
// current choice rides in ViewportRenderingState.bandSelection (the
// editor-owned pattern shared with CT-209): a ready-made preset computed at Apply,
// or a custom formula/imported-tool band already computed by the CT-208 scripting
// worker and remembered under a token. The status line names the active function,
// which is the observable proof the worker ran.

const PRESETS: ReadonlyArray<BandSelectionPreset> = ["average", "variance"];

interface BandSelectionFunctionEditorProps {
  viewportIndex: number;
  raster: RasterImage;
}

export function BandSelectionFunctionEditor(
  props: BandSelectionFunctionEditorProps,
): JSX.Element {
  const binding = useBandSelectionBinding(props.viewportIndex);
  const runner = useRunUserScriptForBand(props.viewportIndex, props.raster, binding.setCustomResult);
  useInitializeBandSelectionWhenAbsent(binding);
  return <LoadedBandSelectionEditor binding={binding} runner={runner} />;
}

interface BandSelectionBinding {
  choice: BandSelectionEditingState | null;
  setPreset: (preset: BandSelectionPreset) => void;
  setCustomResult: (token: string, description: string) => void;
}

function useBandSelectionBinding(viewportIndex: number): BandSelectionBinding {
  const renderingApi = useViewportRendering();
  const choice = renderingApi.getRenderingState(viewportIndex).bandSelection;
  const setChoice = useCallback(
    (next: BandSelectionEditingState) => {
      const current = renderingApi.getRenderingState(viewportIndex);
      renderingApi.setRenderingState(viewportIndex, { ...current, bandSelection: next });
    },
    [renderingApi, viewportIndex],
  );
  return {
    choice,
    setPreset: (preset) => setChoice({ kind: "preset", preset }),
    setCustomResult: (token, description) => setChoice({ kind: "custom", token, description }),
  };
}

function useInitializeBandSelectionWhenAbsent(binding: BandSelectionBinding): void {
  const hasChoice = binding.choice !== null;
  const { setPreset } = binding;
  useEffect(() => {
    if (hasChoice) return;
    setPreset("average");
  }, [hasChoice, setPreset]);
}

interface UserScriptBandRunner {
  isRunning: boolean;
  runFormula: (expression: string) => void;
  runImport: () => void;
}

function useRunUserScriptForBand(
  viewportIndex: number,
  raster: RasterImage,
  setCustomResult: (token: string, description: string) => void,
): UserScriptBandRunner {
  const busyRegistrar = useBusyEntryRegistrar();
  const [isRunning, setIsRunning] = useState(false);
  const run = useCallback(
    (source: ToolboxRunUserScriptSource) => {
      void executeUserScriptForBand({ busyRegistrar, viewportIndex }, raster, source, setCustomResult, setIsRunning);
    },
    [busyRegistrar, viewportIndex, raster, setCustomResult],
  );
  return {
    isRunning,
    runFormula: (expression) => run({ mode: "formula", expression }),
    runImport: () => run({ mode: "import" }),
  };
}

async function executeUserScriptForBand(
  bindings: UserScriptRunFlowBindings,
  raster: RasterImage,
  source: ToolboxRunUserScriptSource,
  setCustomResult: (token: string, description: string) => void,
  setIsRunning: (next: boolean) => void,
): Promise<void> {
  setIsRunning(true);
  try {
    const result = await runUserScriptOnRasterShowingViewportBusy(bindings, raster, source);
    rememberUserScriptBandResult(result, raster, setCustomResult);
  } catch (error) {
    notifyError(describeBandScriptError(error));
  } finally {
    setIsRunning(false);
  }
}

function rememberUserScriptBandResult(
  result: ToolboxRunUserScriptResult,
  raster: RasterImage,
  setCustomResult: (token: string, description: string) => void,
): void {
  if (result.status === "canceled") return;
  if (result.status === "failed") throw new Error(result.message);
  // This editor always requests resultKind "value", so a cube result is a harness bug.
  if (result.status !== "completed") throw new Error("The script returned an unexpected result.");
  const rows = validateBandSelectionReturnValue(result.value, { height: raster.height, width: raster.width });
  const values = flattenBandMatrixToFloat32(rows, raster.width, raster.height);
  const token = rememberBandSelectionResult({ values, width: raster.width, height: raster.height });
  setCustomResult(token, describeCustomBandResult(result.sourceName));
}

function describeCustomBandResult(sourceName: string | undefined): string {
  return sourceName === undefined ? FORMULA_BAND_SELECTION_DESCRIPTION : describeImportedToolBandSelection(sourceName);
}

function describeBandScriptError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface LoadedBandSelectionEditorProps {
  binding: BandSelectionBinding;
  runner: UserScriptBandRunner;
}

function LoadedBandSelectionEditor(props: LoadedBandSelectionEditorProps): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs font-medium text-muted-foreground">Reduce to one band</span>
      <BandSelectionPresetButtons binding={props.binding} disabled={props.runner.isRunning} />
      <BandSelectionScriptControls runner={props.runner} />
      <BandSelectionStatus choice={props.binding.choice} />
      <p className="text-xs text-muted-foreground">
        Choose a ready-made function, run a formula, or import a tool to reduce the stack to a single
        band. The stack changes only on Apply.
      </p>
    </div>
  );
}

interface BandSelectionPresetButtonsProps {
  binding: BandSelectionBinding;
  disabled: boolean;
}

function BandSelectionPresetButtons(props: BandSelectionPresetButtonsProps): JSX.Element {
  return (
    <div className="flex gap-2">
      {PRESETS.map((preset) => (
        <Button
          key={preset}
          type="button"
          variant={isActivePreset(props.binding.choice, preset) ? "default" : "outline"}
          size="sm"
          aria-pressed={isActivePreset(props.binding.choice, preset)}
          disabled={props.disabled}
          onClick={() => props.binding.setPreset(preset)}
        >
          {BAND_SELECTION_PRESET_LABELS[preset]}
        </Button>
      ))}
    </div>
  );
}

interface BandSelectionScriptControlsProps {
  runner: UserScriptBandRunner;
}

function BandSelectionScriptControls(props: BandSelectionScriptControlsProps): JSX.Element {
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-2">
      <BandSelectionFormulaField runner={props.runner} />
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

function BandSelectionFormulaField(props: BandSelectionScriptControlsProps): JSX.Element {
  const [expression, setExpression] = useState("");
  const runFormula = () => runFormulaIfPresent(expression, props.runner);
  return (
    <div className="flex items-end gap-2">
      <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
        Formula
        <Input
          aria-label="Band formula"
          placeholder="e.g. cube.mean(axis=0)"
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

function BandSelectionStatus({ choice }: { choice: BandSelectionEditingState | null }): JSX.Element {
  return (
    <p className="text-xs font-medium text-foreground">
      Selected function: {describeBandSelectionFunction(choice)}
    </p>
  );
}

function runFormulaIfPresent(expression: string, runner: UserScriptBandRunner): void {
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

function isActivePreset(
  choice: BandSelectionEditingState | null,
  preset: BandSelectionPreset,
): boolean {
  return choice?.kind === "preset" && choice.preset === preset;
}
