import { useState, type FormEvent, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ViewportCellContent } from "@/components/viewport-grid";
import type { RegisteredViewportAction } from "@/lib/actions/registered-actions";
import { getViewportNumberFromIndex } from "@/lib/grid/grid-layout";

export interface PendingDuplicateReplace {
  readonly sourceIndex: number;
  readonly sourceContent: ViewportCellContent;
  readonly postDuplicateAction?: RegisteredViewportAction;
}

export interface DuplicateReplaceTargetEntry {
  readonly index: number;
  readonly fileName: string;
}

interface DuplicateReplacePickerProps {
  pending: PendingDuplicateReplace | null;
  viewports: ReadonlyArray<DuplicateReplaceTargetEntry>;
  onCancel: () => void;
  onConfirm: (targetIndex: number) => void;
}

export function DuplicateReplaceTargetPicker(
  props: DuplicateReplacePickerProps,
): JSX.Element {
  return (
    <Dialog
      open={props.pending !== null}
      onOpenChange={(open) => closePickerWhenDismissed(open, props.onCancel)}
    >
      <DialogContent>
        {props.pending ? renderReplacePickerForm(props.pending, props) : null}
      </DialogContent>
    </Dialog>
  );
}

function closePickerWhenDismissed(open: boolean, onCancel: () => void): void {
  if (!open) onCancel();
}

function renderReplacePickerForm(
  pending: PendingDuplicateReplace,
  props: DuplicateReplacePickerProps,
): JSX.Element {
  return (
    <ReplacePickerForm
      pending={pending}
      viewports={props.viewports}
      onCancel={props.onCancel}
      onConfirm={props.onConfirm}
    />
  );
}

interface ReplacePickerFormProps {
  pending: PendingDuplicateReplace;
  viewports: ReadonlyArray<DuplicateReplaceTargetEntry>;
  onCancel: () => void;
  onConfirm: (targetIndex: number) => void;
}

function ReplacePickerForm(props: ReplacePickerFormProps): JSX.Element {
  const [chosenIndex, setChosenIndex] = useState<number | null>(null);
  const handleSubmit = (event: FormEvent<HTMLFormElement>) =>
    submitReplacePickerForm(event, chosenIndex, props.onConfirm);
  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>) =>
    submitOnEnterKeyWhenAnyTargetChosen(event, chosenIndex, props.onConfirm);
  return (
    <form className="contents" onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
      <ReplacePickerHeader fileName={props.pending.sourceContent.fileName} />
      <ReplacePickerViewportList
        viewports={props.viewports}
        chosenIndex={chosenIndex}
        onChoose={setChosenIndex}
      />
      <ReplacePickerFooter chosen={chosenIndex !== null} onCancel={props.onCancel} />
    </form>
  );
}

function submitReplacePickerForm(
  event: FormEvent<HTMLFormElement>,
  chosenIndex: number | null,
  onConfirm: (index: number) => void,
): void {
  event.preventDefault();
  if (chosenIndex === null) return;
  onConfirm(chosenIndex);
}

function submitOnEnterKeyWhenAnyTargetChosen(
  event: KeyboardEvent<HTMLFormElement>,
  chosenIndex: number | null,
  onConfirm: (index: number) => void,
): void {
  if (event.key !== "Enter" || event.defaultPrevented) return;
  if (chosenIndex === null) return;
  event.preventDefault();
  onConfirm(chosenIndex);
}

function ReplacePickerHeader({ fileName }: { fileName: string }): JSX.Element {
  return (
    <DialogHeader>
      <DialogTitle>Replace which viewport?</DialogTitle>
      <DialogDescription>{describeReplacePickerPrompt(fileName)}</DialogDescription>
    </DialogHeader>
  );
}

function describeReplacePickerPrompt(fileName: string): string {
  return `The grid is at its maximum size and every viewport is in use. Choose a viewport to replace with a duplicate of "${fileName}".`;
}

interface ReplacePickerViewportListProps {
  viewports: ReadonlyArray<DuplicateReplaceTargetEntry>;
  chosenIndex: number | null;
  onChoose: (index: number) => void;
}

function ReplacePickerViewportList(
  props: ReplacePickerViewportListProps,
): JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label="Replace target viewport"
      className="flex max-h-72 flex-col gap-1 overflow-y-auto pr-1"
    >
      {props.viewports.map((viewport) => (
        <ReplacePickerViewportRow
          key={viewport.index}
          viewport={viewport}
          isChosen={props.chosenIndex === viewport.index}
          onChoose={() => props.onChoose(viewport.index)}
        />
      ))}
    </div>
  );
}

interface ReplacePickerViewportRowProps {
  viewport: DuplicateReplaceTargetEntry;
  isChosen: boolean;
  onChoose: () => void;
}

function ReplacePickerViewportRow(
  props: ReplacePickerViewportRowProps,
): JSX.Element {
  const label = describeReplacePickerRowLabel(props.viewport);
  const id = `duplicate-replace-viewport-${props.viewport.index}`;
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
    >
      <input
        id={id}
        type="radio"
        name="duplicate-replace-target-viewport"
        className="size-4 accent-primary"
        checked={props.isChosen}
        onChange={props.onChoose}
        aria-label={label}
      />
      <span className="truncate" title={label}>
        {label}
      </span>
    </label>
  );
}

function describeReplacePickerRowLabel(viewport: DuplicateReplaceTargetEntry): string {
  const number = getViewportNumberFromIndex(viewport.index);
  return `Viewport ${number} (${viewport.fileName})`;
}

function ReplacePickerFooter({
  chosen,
  onCancel,
}: {
  chosen: boolean;
  onCancel: () => void;
}): JSX.Element {
  return (
    <DialogFooter>
      <Button type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={!chosen}>
        Replace
      </Button>
    </DialogFooter>
  );
}
