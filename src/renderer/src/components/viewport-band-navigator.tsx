import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { useEffect, useState, type KeyboardEvent, type WheelEvent } from "react";

import { useDebouncedBandSelection } from "@/components/use-debounced-band-selection";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  clampBandIndexWithinCount,
  formatBandNumberForInput,
  parseTypedBandNumberToIndexOrNull,
  pickBandStepDirectionFromWheelDelta,
  stepBandIndexInDirection,
} from "@/lib/image/band-navigation";

interface ViewportBandNavigatorProps {
  bandCount: number;
  selectedBandIndex: number;
  onSelectBandIndex: (bandIndex: number) => void;
  onRemoveBand?: (bandIndex: number) => void;
}

export function ViewportBandNavigator(props: ViewportBandNavigatorProps): JSX.Element {
  const activeBandIndex = clampBandIndexWithinCount(props.selectedBandIndex, props.bandCount);
  const selection = useDebouncedBandSelection(activeBandIndex, props.onSelectBandIndex);
  const displayedBandIndex = selection.displayedBandIndex;
  const stepBandBy = (direction: number) =>
    selection.requestBandSelectionDebounced(
      stepBandIndexInDirection(displayedBandIndex, direction, props.bandCount),
    );
  return (
    <div
      data-testid="viewport-band-navigator"
      className="pointer-events-auto absolute inset-x-0 bottom-3 mx-auto flex w-[min(460px,86%)] items-center gap-2 rounded-md border bg-card/90 px-3 py-2 shadow-lg backdrop-blur"
      onWheel={(event) => handleBandNavigatorWheel(event, stepBandBy)}
    >
      <span className="shrink-0 text-xs font-medium text-muted-foreground">Band</span>
      <BandStepButton label="Previous band" icon={<ChevronLeft />} onStep={() => stepBandBy(-1)} />
      <BandSlider
        bandCount={props.bandCount}
        activeBandIndex={displayedBandIndex}
        onRequestBandIndex={selection.requestBandSelectionDebounced}
      />
      <BandStepButton label="Next band" icon={<ChevronRight />} onStep={() => stepBandBy(1)} />
      <BandNumberInput
        bandCount={props.bandCount}
        activeBandIndex={displayedBandIndex}
        onCommitBandIndex={selection.commitBandSelectionImmediately}
      />
      <span className="shrink-0 font-mono text-xs text-muted-foreground">/ {props.bandCount}</span>
      {props.onRemoveBand ? (
        <RemoveBandButton
          bandNumber={displayedBandIndex + 1}
          bandCount={props.bandCount}
          disabled={props.bandCount <= 1}
          onRemove={() => props.onRemoveBand?.(displayedBandIndex)}
        />
      ) : null}
    </div>
  );
}

interface RemoveBandButtonProps {
  bandNumber: number;
  bandCount: number;
  disabled: boolean;
  onRemove: () => void;
}

// Band removal is irreversible (there is no undo), so the trash button opens a
// confirmation dialog (CT-254); the existing removal path runs only on confirm.
function RemoveBandButton(props: RemoveBandButtonProps): JSX.Element {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{buildRemoveBandTriggerButton(props)}</AlertDialogTrigger>
      <RemoveBandConfirmationDialogContent
        bandNumber={props.bandNumber}
        bandCount={props.bandCount}
        onConfirmRemove={props.onRemove}
      />
    </AlertDialog>
  );
}

function buildRemoveBandTriggerButton(props: RemoveBandButtonProps): JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={`Remove band ${props.bandNumber}`}
      title={`Remove band ${props.bandNumber}`}
      className="size-7 shrink-0 text-destructive hover:text-destructive"
      disabled={props.disabled}
    >
      <Trash2 />
    </Button>
  );
}

interface RemoveBandConfirmationDialogContentProps {
  bandNumber: number;
  bandCount: number;
  onConfirmRemove: () => void;
}

function RemoveBandConfirmationDialogContent(
  props: RemoveBandConfirmationDialogContentProps,
): JSX.Element {
  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{`Remove band ${props.bandNumber}?`}</AlertDialogTitle>
        <AlertDialogDescription>
          {`Band ${props.bandNumber} of ${props.bandCount} will be removed from the stack. This cannot be undone.`}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <RemoveBandConfirmationDialogFooter onConfirmRemove={props.onConfirmRemove} />
    </AlertDialogContent>
  );
}

function RemoveBandConfirmationDialogFooter(props: { onConfirmRemove: () => void }): JSX.Element {
  return (
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction
        className={buttonVariants({ variant: "destructive" })}
        onClick={props.onConfirmRemove}
      >
        Remove band
      </AlertDialogAction>
    </AlertDialogFooter>
  );
}

function handleBandNavigatorWheel(
  event: WheelEvent<HTMLDivElement>,
  stepBandBy: (direction: number) => void,
): void {
  if (event.deltaY === 0) return;
  event.preventDefault();
  stepBandBy(pickBandStepDirectionFromWheelDelta(event.deltaY));
}

interface BandStepButtonProps {
  label: string;
  icon: JSX.Element;
  onStep: () => void;
}

// The chevrons wrap past either end (CT-253), so they are never disabled; the
// navigator only renders for multi-band stacks.
function BandStepButton(props: BandStepButtonProps): JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={props.label}
      className="size-7 shrink-0"
      onClick={props.onStep}
    >
      {props.icon}
    </Button>
  );
}

interface BandSliderProps {
  bandCount: number;
  activeBandIndex: number;
  onRequestBandIndex: (bandIndex: number) => void;
}

function BandSlider(props: BandSliderProps): JSX.Element {
  return (
    <Slider
      aria-label="Active band"
      className="min-w-0 flex-1"
      min={0}
      max={props.bandCount - 1}
      step={1}
      value={[props.activeBandIndex]}
      onValueChange={(values) => commitSliderValue(values, props.bandCount, props.onRequestBandIndex)}
    />
  );
}

function commitSliderValue(
  values: ReadonlyArray<number>,
  bandCount: number,
  onRequestBandIndex: (bandIndex: number) => void,
): void {
  const next = values[0];
  if (next === undefined) return;
  onRequestBandIndex(clampBandIndexWithinCount(next, bandCount));
}

interface BandNumberInputProps {
  bandCount: number;
  activeBandIndex: number;
  onCommitBandIndex: (bandIndex: number) => void;
}

function BandNumberInput(props: BandNumberInputProps): JSX.Element {
  const [draftText, setDraftText] = useState(() => formatBandNumberForInput(props.activeBandIndex));
  useEffect(() => {
    setDraftText(formatBandNumberForInput(props.activeBandIndex));
  }, [props.activeBandIndex]);
  const commitDraft = () => commitDraftBandNumber(draftText, props, setDraftText);
  return (
    <Input
      aria-label="Go to band number"
      inputMode="numeric"
      className="h-7 w-14 shrink-0 px-2 text-center font-mono text-xs"
      value={draftText}
      onChange={(event) => setDraftText(event.target.value)}
      onBlur={commitDraft}
      onKeyDown={(event) => handleBandNumberInputKeyDown(event, commitDraft)}
    />
  );
}

function handleBandNumberInputKeyDown(
  event: KeyboardEvent<HTMLInputElement>,
  commitDraft: () => void,
): void {
  if (event.key !== "Enter") return;
  event.preventDefault();
  commitDraft();
}

function commitDraftBandNumber(
  draftText: string,
  props: BandNumberInputProps,
  setDraftText: (text: string) => void,
): void {
  const parsedIndex = parseTypedBandNumberToIndexOrNull(draftText, props.bandCount);
  if (parsedIndex === null) {
    setDraftText(formatBandNumberForInput(props.activeBandIndex));
    return;
  }
  props.onCommitBandIndex(parsedIndex);
}
