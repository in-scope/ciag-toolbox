import {
  useCallback,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { toast } from "sonner";

import { ScriptDocsLink } from "@/components/script-docs-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { validateTransformedCubeAgainstSource } from "@/lib/image/band-ops/cube-transform-contract";
import {
  buildFormulaCubeTransformState,
  buildImportedToolCubeTransformState,
  describeCubeTransformRunError,
  formatCubeTransformStatusLine,
  type CubeTransformEditingState,
} from "@/lib/image/band-ops/cube-transform-editing";
import { rememberCubeTransformResult } from "@/lib/image/band-ops/cube-transform-result-store";
import type { RasterImage } from "@/lib/image/raster-image";
import { buildUserScriptCubeFromRaster } from "@/lib/python/user-script-cube";
import { useViewportRendering } from "@/state/viewport-rendering-context";

// CT-216: the custom-transform controls embedded in the Custom Transform
// operation panel. Running Python happens ONLY here, at Run formula / Import
// script time (the CT-209/210 model): the worker's cube result is validated
// against the source stack, remembered in the result store under a token, and
// the ready choice rides in ViewportRenderingState.cubeTransform. The status
// line names the ready transform and its output band count, which is the
// observable proof the worker ran; Apply is synchronous from the store.

interface ToolOptionsCustomTransformEditorProps {
  viewportIndex: number;
  raster: RasterImage;
}

export function ToolOptionsCustomTransformEditor(
  props: ToolOptionsCustomTransformEditorProps,
): JSX.Element {
  const binding = useCubeTransformBinding(props.viewportIndex);
  const runner = useRunUserScriptForCubeTransform(props.raster, binding.setReadyTransform);
  return <LoadedCustomTransformEditor state={binding.state} runner={runner} />;
}

interface CubeTransformBinding {
  state: CubeTransformEditingState | null;
  setReadyTransform: (next: CubeTransformEditingState) => void;
}

function useCubeTransformBinding(viewportIndex: number): CubeTransformBinding {
  const renderingApi = useViewportRendering();
  const state = renderingApi.getRenderingState(viewportIndex).cubeTransform;
  const setReadyTransform = useCallback(
    (next: CubeTransformEditingState) => {
      const current = renderingApi.getRenderingState(viewportIndex);
      renderingApi.setRenderingState(viewportIndex, { ...current, cubeTransform: next });
    },
    [renderingApi, viewportIndex],
  );
  return { state, setReadyTransform };
}

interface UserScriptCubeTransformRunner {
  isRunning: boolean;
  runFormula: (expression: string) => void;
  runImport: () => void;
}

function useRunUserScriptForCubeTransform(
  raster: RasterImage,
  setReadyTransform: (next: CubeTransformEditingState) => void,
): UserScriptCubeTransformRunner {
  const [isRunning, setIsRunning] = useState(false);
  const run = useCallback(
    (source: ToolboxRunUserScriptSource) => {
      void executeCubeTransformUserScript(raster, source, setReadyTransform, setIsRunning);
    },
    [raster, setReadyTransform],
  );
  return {
    isRunning,
    runFormula: (expression) => run({ mode: "formula", expression }),
    runImport: () => run({ mode: "import" }),
  };
}

async function executeCubeTransformUserScript(
  raster: RasterImage,
  source: ToolboxRunUserScriptSource,
  setReadyTransform: (next: CubeTransformEditingState) => void,
  setIsRunning: (next: boolean) => void,
): Promise<void> {
  setIsRunning(true);
  try {
    const result = await runUserScriptForCubeTransform(raster, source);
    rememberCubeTransformRunResult(result, raster, source, setReadyTransform);
  } catch (error) {
    toast.error(describeCubeTransformRunError(error));
  } finally {
    setIsRunning(false);
  }
}

function runUserScriptForCubeTransform(
  raster: RasterImage,
  source: ToolboxRunUserScriptSource,
): Promise<ToolboxRunUserScriptResult> {
  return window.toolboxApi.runUserScript({
    cube: buildUserScriptCubeFromRaster(raster),
    source,
    resultKind: "cube",
  });
}

function rememberCubeTransformRunResult(
  result: ToolboxRunUserScriptResult,
  raster: RasterImage,
  source: ToolboxRunUserScriptSource,
  setReadyTransform: (next: CubeTransformEditingState) => void,
): void {
  if (result.status === "canceled") return;
  if (result.status !== "completed-cube") throw new Error(describeNonCubeRunResult(result));
  const validated = validateTransformedCubeAgainstSource(result.shape, result.bands, raster.height, raster.width);
  const token = rememberCubeTransformResult(validated);
  setReadyTransform(buildReadyTransformState(token, validated.bands.length, source, result.sourceName));
}

function describeNonCubeRunResult(
  result: Extract<ToolboxRunUserScriptResult, { status: "completed" | "failed" }>,
): string {
  return result.status === "failed" ? result.message : "The script returned an unexpected result.";
}

function buildReadyTransformState(
  token: string,
  outputBandCount: number,
  source: ToolboxRunUserScriptSource,
  sourceName: string | undefined,
): CubeTransformEditingState {
  if (source.mode === "formula") {
    return buildFormulaCubeTransformState(token, outputBandCount, source.expression);
  }
  return buildImportedToolCubeTransformState(token, outputBandCount, sourceName);
}

interface LoadedCustomTransformEditorProps {
  state: CubeTransformEditingState | null;
  runner: UserScriptCubeTransformRunner;
}

function LoadedCustomTransformEditor(props: LoadedCustomTransformEditorProps): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs font-medium text-muted-foreground">Transform the whole stack</span>
      <CustomTransformScriptControls runner={props.runner} />
      <CustomTransformStatus state={props.state} />
      <p className="text-xs text-muted-foreground">
        Run a formula or import a tool that returns a transformed stack with the same height and
        width as the source; the band count is free. The stack changes only on Apply.
      </p>
    </div>
  );
}

interface CustomTransformScriptControlsProps {
  runner: UserScriptCubeTransformRunner;
}

function CustomTransformScriptControls(props: CustomTransformScriptControlsProps): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <CustomTransformFormulaField runner={props.runner} />
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

function CustomTransformFormulaField(props: CustomTransformScriptControlsProps): JSX.Element {
  const [expression, setExpression] = useState("");
  const runFormula = () => runFormulaIfPresent(expression, props.runner);
  return (
    <div className="flex items-end gap-2">
      <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
        Formula
        <Input
          aria-label="Transform formula"
          placeholder="e.g. cube * 2"
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

function CustomTransformStatus({ state }: { state: CubeTransformEditingState | null }): JSX.Element {
  return (
    <p className="text-xs font-medium text-foreground">{formatCubeTransformStatusLine(state)}</p>
  );
}

function runFormulaIfPresent(expression: string, runner: UserScriptCubeTransformRunner): void {
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
