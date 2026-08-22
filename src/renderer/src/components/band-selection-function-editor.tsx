import { useCallback, useEffect } from "react";

import { notifyError } from "@/lib/notifications/notify";
import { ScriptDocsLink } from "@/components/script-docs-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { BandSelectionEditingState } from "@/lib/image/band-ops/band-selection";
import {
  BAND_SELECTION_PRESET_LABELS,
  buildBandSelectionChoiceForMode,
  buildFormulaBandSelectionState,
  buildImportedToolBandSelectionState,
  formatBandSelectionCustomInputStatus,
  isCustomBandSelection,
  readBandSelectionFormulaText,
  readBandSelectionFunctionMode,
  type BandSelectionFunctionMode,
} from "@/lib/image/band-ops/band-selection-editing";
import { useViewportRendering } from "@/state/viewport-rendering-context";

// CT-210: the band-selection controls. CT-284 rehoused them from the Band
// Selection operation panel into the Subset Bands editor's "By function" mode.
//
// CT-293: the three functions are ONE exclusive choice on a segmented control -
// Average, Variance, Custom - and Custom is the only one that reveals the
// formula field and "Import script...". Nothing runs here: the editor writes the
// configured choice into ViewportRenderingState.bandSelection and Apply runs it
// (the CT-216 custom-transform pattern), so an imported script is re-read from
// disk on every Apply and a failed run leaves this editor open.

export interface BandSelectionFunctionEditorProps {
  readonly viewportIndex: number;
}

export function BandSelectionFunctionEditor(
  props: BandSelectionFunctionEditorProps,
): JSX.Element {
  const binding = useBandSelectionBinding(props.viewportIndex);
  useInitializeBandSelectionWhenAbsent(binding);
  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs font-medium text-muted-foreground">Reduce to one band</span>
      <BandSelectionFunctionSegments binding={binding} />
      {isCustomBandSelection(binding.choice) ? (
        <BandSelectionCustomInputControls binding={binding} />
      ) : null}
      <p className="text-xs text-muted-foreground">
        Choose a ready-made function, or pick Custom to enter a formula or import a tool that
        returns one band. The stack changes only on Apply.
      </p>
    </div>
  );
}

interface BandSelectionBinding {
  readonly choice: BandSelectionEditingState | null;
  readonly setChoice: (next: BandSelectionEditingState) => void;
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
  return { choice, setChoice };
}

function useInitializeBandSelectionWhenAbsent(binding: BandSelectionBinding): void {
  const hasChoice = binding.choice !== null;
  const { setChoice } = binding;
  useEffect(() => {
    if (hasChoice) return;
    setChoice({ kind: "preset", preset: "average" });
  }, [hasChoice, setChoice]);
}

interface BandSelectionControlProps {
  readonly binding: BandSelectionBinding;
}

function BandSelectionFunctionSegments(props: BandSelectionControlProps): JSX.Element {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      aria-label="Function"
      className="justify-stretch"
      value={readBandSelectionFunctionMode(props.binding.choice)}
      onValueChange={(next) => onFunctionSegmentChosen(next, props.binding)}
    >
      <ToggleGroupItem value="average" className="flex-1">
        {BAND_SELECTION_PRESET_LABELS.average}
      </ToggleGroupItem>
      <ToggleGroupItem value="variance" className="flex-1">
        {BAND_SELECTION_PRESET_LABELS.variance}
      </ToggleGroupItem>
      <ToggleGroupItem value="custom" className="flex-1">
        Custom
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

// Radix ToggleGroup type="single" reports an empty string when the pressed
// segment is clicked again; ignore it so exactly one function stays chosen.
function onFunctionSegmentChosen(nextValue: string, binding: BandSelectionBinding): void {
  if (nextValue === "") return;
  binding.setChoice(
    buildBandSelectionChoiceForMode(nextValue as BandSelectionFunctionMode, binding.choice),
  );
}

function BandSelectionCustomInputControls(props: BandSelectionControlProps): JSX.Element {
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-2">
      <BandSelectionFormulaField binding={props.binding} />
      <div className="flex items-center justify-between gap-2">
        <ImportBandSelectionScriptButton binding={props.binding} />
        <ScriptDocsLink />
      </div>
      <p className="text-xs font-medium text-foreground">
        {formatBandSelectionCustomInputStatus(props.binding.choice)}
      </p>
    </div>
  );
}

function BandSelectionFormulaField(props: BandSelectionControlProps): JSX.Element {
  const { choice, setChoice } = props.binding;
  return (
    <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
      Formula
      <Input
        aria-label="Band formula"
        placeholder="e.g. cube.mean(axis=0)"
        value={readBandSelectionFormulaText(choice)}
        onChange={(event) => setChoice(buildFormulaBandSelectionState(event.target.value))}
        className="h-8 text-foreground"
      />
    </label>
  );
}

function ImportBandSelectionScriptButton(props: BandSelectionControlProps): JSX.Element {
  const pickScriptFile = () => pickBandSelectionScriptFile(props.binding.setChoice);
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => void pickScriptFile()}>
      Import script...
    </Button>
  );
}

async function pickBandSelectionScriptFile(
  setChoice: (next: BandSelectionEditingState) => void,
): Promise<void> {
  try {
    const picked = await window.toolboxApi.pickUserScriptFile();
    if (picked.canceled) return;
    setChoice(buildImportedToolBandSelectionState(picked.filePath, picked.fileName));
  } catch (error) {
    notifyError(error instanceof Error ? error.message : String(error));
  }
}
