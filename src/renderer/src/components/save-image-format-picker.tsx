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
import {
  SAVE_IMAGE_FORMAT_OPTIONS,
  type SaveImageFormatId,
} from "@/lib/image/save-image-formats";
import { cn } from "@/lib/utils";

export interface PendingSaveImageFormatChoice {
  readonly fileName: string;
}

interface SaveImageFormatPickerProps {
  pending: PendingSaveImageFormatChoice | null;
  onCancel: () => void;
  onConfirm: (formatId: SaveImageFormatId) => void;
}

export function SaveImageFormatPicker(
  props: SaveImageFormatPickerProps,
): JSX.Element {
  return (
    <Dialog
      open={props.pending !== null}
      onOpenChange={(open) => closePickerWhenDismissed(open, props.onCancel)}
    >
      <DialogContent>
        {props.pending ? renderFormatPickerForm(props.pending, props) : null}
      </DialogContent>
    </Dialog>
  );
}

function closePickerWhenDismissed(open: boolean, onCancel: () => void): void {
  if (!open) onCancel();
}

function renderFormatPickerForm(
  pending: PendingSaveImageFormatChoice,
  props: SaveImageFormatPickerProps,
): JSX.Element {
  return (
    <FormatPickerForm
      pending={pending}
      onCancel={props.onCancel}
      onConfirm={props.onConfirm}
    />
  );
}

interface FormatPickerFormProps {
  pending: PendingSaveImageFormatChoice;
  onCancel: () => void;
  onConfirm: (formatId: SaveImageFormatId) => void;
}

function FormatPickerForm(props: FormatPickerFormProps): JSX.Element {
  const [chosenId, setChosenId] = useState<SaveImageFormatId>(
    SAVE_IMAGE_FORMAT_OPTIONS[0]!.id,
  );
  const handleSubmit = (event: FormEvent<HTMLFormElement>) =>
    submitFormatPickerForm(event, chosenId, props.onConfirm);
  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>) =>
    submitOnEnterKey(event, chosenId, props.onConfirm);
  return (
    <form className="contents" onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
      <FormatPickerHeader fileName={props.pending.fileName} />
      <FormatPickerOptionList
        chosenId={chosenId}
        onChoose={setChosenId}
      />
      <FormatPickerFooter onCancel={props.onCancel} />
    </form>
  );
}

function submitFormatPickerForm(
  event: FormEvent<HTMLFormElement>,
  chosenId: SaveImageFormatId,
  onConfirm: (formatId: SaveImageFormatId) => void,
): void {
  event.preventDefault();
  onConfirm(chosenId);
}

function submitOnEnterKey(
  event: KeyboardEvent<HTMLFormElement>,
  chosenId: SaveImageFormatId,
  onConfirm: (formatId: SaveImageFormatId) => void,
): void {
  if (event.key !== "Enter" || event.defaultPrevented) return;
  event.preventDefault();
  onConfirm(chosenId);
}

function FormatPickerHeader({ fileName }: { fileName: string }): JSX.Element {
  return (
    <DialogHeader>
      <DialogTitle>Save image as</DialogTitle>
      <DialogDescription>{describeFormatPickerPrompt(fileName)}</DialogDescription>
    </DialogHeader>
  );
}

function describeFormatPickerPrompt(fileName: string): string {
  return `Choose a format and bit depth for "${fileName}". The next dialog will let you pick the destination on disk.`;
}

interface FormatPickerOptionListProps {
  chosenId: SaveImageFormatId;
  onChoose: (formatId: SaveImageFormatId) => void;
}

function FormatPickerOptionList(props: FormatPickerOptionListProps): JSX.Element {
  return (
    <div role="radiogroup" aria-label="Save format" className="flex flex-col gap-1">
      {SAVE_IMAGE_FORMAT_OPTIONS.map((option) => (
        <FormatPickerOptionRow
          key={option.id}
          formatId={option.id}
          label={option.label}
          description={option.description}
          isChosen={props.chosenId === option.id}
          onChoose={() => props.onChoose(option.id)}
        />
      ))}
    </div>
  );
}

interface FormatPickerOptionRowProps {
  formatId: SaveImageFormatId;
  label: string;
  description: string;
  isChosen: boolean;
  onChoose: () => void;
}

function FormatPickerOptionRow(
  props: FormatPickerOptionRowProps,
): JSX.Element {
  const id = `save-format-${props.formatId}`;
  return (
    <label htmlFor={id} className={getFormatOptionRowClassName(props.isChosen)}>
      <input
        id={id}
        type="radio"
        name="save-image-format"
        className="size-4 cursor-pointer accent-primary"
        checked={props.isChosen}
        onChange={props.onChoose}
        aria-label={props.label}
      />
      <FormatOptionRowLabel label={props.label} description={props.description} />
    </label>
  );
}

function FormatOptionRowLabel({
  label,
  description,
}: {
  label: string;
  description: string;
}): JSX.Element {
  return (
    <div className="flex flex-col">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </div>
  );
}

function getFormatOptionRowClassName(isChosen: boolean): string {
  return cn(
    "flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-accent",
    isChosen && "bg-accent/60",
  );
}

function FormatPickerFooter({
  onCancel,
}: {
  onCancel: () => void;
}): JSX.Element {
  return (
    <DialogFooter>
      <Button type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit">Save...</Button>
    </DialogFooter>
  );
}
