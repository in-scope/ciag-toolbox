import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getViewportNumberFromIndex } from "@/lib/grid/grid-layout";
import type { ViewportImageSource } from "@/lib/webgl/texture";

export interface OpenImageReplaceTargetEntry {
  readonly index: number;
  readonly fileName: string;
}

export interface PendingOpenImageReplaceItem {
  readonly fileName: string;
  readonly source: ViewportImageSource;
  readonly originalFilePath?: string;
  readonly fileSizeBytes?: number;
}

export type PendingOpenImageReplace = PendingOpenImageReplaceItem;

export interface PendingOpenImagesReplace {
  readonly items: ReadonlyArray<PendingOpenImageReplaceItem>;
}

export type OpenImagesReplaceAssignment = ReadonlyMap<number, number>;

export interface ConfirmedOpenImagesReplacePlan {
  readonly assignments: ReadonlyArray<{ itemIndex: number; targetIndex: number }>;
}

interface OpenImageReplacePickerProps {
  pending: PendingOpenImagesReplace | null;
  viewports: ReadonlyArray<OpenImageReplaceTargetEntry>;
  onCancel: () => void;
  onConfirm: (plan: ConfirmedOpenImagesReplacePlan) => void;
}

export function OpenImageReplaceTargetPicker(
  props: OpenImageReplacePickerProps,
): JSX.Element {
  return (
    <Dialog
      open={props.pending !== null && props.pending.items.length > 0}
      onOpenChange={(open) => closePickerWhenDismissed(open, props.onCancel)}
    >
      <DialogContent>
        {props.pending ? (
          <ReplacePickerForm
            pending={props.pending}
            viewports={props.viewports}
            onCancel={props.onCancel}
            onConfirm={props.onConfirm}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function closePickerWhenDismissed(open: boolean, onCancel: () => void): void {
  if (!open) onCancel();
}

interface ReplacePickerFormProps {
  pending: PendingOpenImagesReplace;
  viewports: ReadonlyArray<OpenImageReplaceTargetEntry>;
  onCancel: () => void;
  onConfirm: (plan: ConfirmedOpenImagesReplacePlan) => void;
}

function ReplacePickerForm(props: ReplacePickerFormProps): JSX.Element {
  const [assignments, setAssignments] = useState<OpenImagesReplaceAssignment>(
    () => buildInitialAssignmentsForPending(props.pending, props.viewports),
  );
  const isReadyToConfirm = useMemo(
    () => assignments.size === props.pending.items.length,
    [assignments, props.pending.items.length],
  );
  const handleSubmit = (event: FormEvent<HTMLFormElement>) =>
    submitFormWithAssignments(event, isReadyToConfirm, assignments, props.onConfirm);
  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>) =>
    submitOnEnterWhenReady(event, isReadyToConfirm, assignments, props.onConfirm);
  return (
    <form className="contents" onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
      <ReplacePickerHeader pending={props.pending} />
      <ReplaceAllStartingAtViewportControl
        viewports={props.viewports}
        onApplyStartAt={(startIndex) =>
          setAssignments(buildSequentialAssignmentsFromStart(startIndex, props.pending, props.viewports))
        }
      />
      <ReplacePickerItemAssignmentList
        items={props.pending.items}
        viewports={props.viewports}
        assignments={assignments}
        onChoose={(itemIndex, targetIndex) =>
          setAssignments(updateAssignmentForItem(assignments, itemIndex, targetIndex))
        }
      />
      <ReplacePickerFooter ready={isReadyToConfirm} onCancel={props.onCancel} />
    </form>
  );
}

function buildInitialAssignmentsForPending(
  pending: PendingOpenImagesReplace,
  viewports: ReadonlyArray<OpenImageReplaceTargetEntry>,
): OpenImagesReplaceAssignment {
  if (pending.items.length === 1 && viewports.length > 0) {
    return new Map();
  }
  return new Map();
}

function buildSequentialAssignmentsFromStart(
  startIndex: number,
  pending: PendingOpenImagesReplace,
  viewports: ReadonlyArray<OpenImageReplaceTargetEntry>,
): OpenImagesReplaceAssignment {
  const map = new Map<number, number>();
  for (let i = 0; i < pending.items.length; i++) {
    const target = pickViewportFromSequenceWrapping(viewports, startIndex, i);
    if (target === null) break;
    map.set(i, target);
  }
  return map;
}

function pickViewportFromSequenceWrapping(
  viewports: ReadonlyArray<OpenImageReplaceTargetEntry>,
  startIndex: number,
  offset: number,
): number | null {
  const startPos = viewports.findIndex((viewport) => viewport.index === startIndex);
  if (startPos === -1) return null;
  const targetPos = startPos + offset;
  if (targetPos >= viewports.length) return null;
  return viewports[targetPos]?.index ?? null;
}

function updateAssignmentForItem(
  assignments: OpenImagesReplaceAssignment,
  itemIndex: number,
  targetIndex: number,
): OpenImagesReplaceAssignment {
  const next = new Map(assignments);
  next.set(itemIndex, targetIndex);
  return next;
}

function submitFormWithAssignments(
  event: FormEvent<HTMLFormElement>,
  isReady: boolean,
  assignments: OpenImagesReplaceAssignment,
  onConfirm: (plan: ConfirmedOpenImagesReplacePlan) => void,
): void {
  event.preventDefault();
  if (!isReady) return;
  onConfirm({ assignments: buildAssignmentPairsFromMap(assignments) });
}

function submitOnEnterWhenReady(
  event: KeyboardEvent<HTMLFormElement>,
  isReady: boolean,
  assignments: OpenImagesReplaceAssignment,
  onConfirm: (plan: ConfirmedOpenImagesReplacePlan) => void,
): void {
  if (event.key !== "Enter" || event.defaultPrevented) return;
  if (!isReady) return;
  event.preventDefault();
  onConfirm({ assignments: buildAssignmentPairsFromMap(assignments) });
}

function buildAssignmentPairsFromMap(
  assignments: OpenImagesReplaceAssignment,
): ReadonlyArray<{ itemIndex: number; targetIndex: number }> {
  const pairs: { itemIndex: number; targetIndex: number }[] = [];
  for (const [itemIndex, targetIndex] of assignments) {
    pairs.push({ itemIndex, targetIndex });
  }
  return pairs.sort((a, b) => a.itemIndex - b.itemIndex);
}

function ReplacePickerHeader({ pending }: { pending: PendingOpenImagesReplace }): JSX.Element {
  return (
    <DialogHeader>
      <DialogTitle>{pickReplaceDialogTitleForCount(pending.items.length)}</DialogTitle>
      <DialogDescription>{describeReplacePickerPrompt(pending)}</DialogDescription>
    </DialogHeader>
  );
}

function pickReplaceDialogTitleForCount(itemCount: number): string {
  if (itemCount === 1) return "Replace which viewport?";
  return `Assign replacement viewports for ${itemCount} images`;
}

function describeReplacePickerPrompt(pending: PendingOpenImagesReplace): string {
  if (pending.items.length === 1) {
    const only = pending.items[0]!;
    return `Every viewport in the current grid already holds an image. Choose a viewport to replace with "${only.fileName}".`;
  }
  return `The current grid cannot fit all ${pending.items.length} pending images. Pick a replacement viewport for each item, or use "Replace all starting at viewport N" to fill in sequence.`;
}

interface ReplaceAllStartingAtViewportControlProps {
  viewports: ReadonlyArray<OpenImageReplaceTargetEntry>;
  onApplyStartAt: (startIndex: number) => void;
}

function ReplaceAllStartingAtViewportControl(
  props: ReplaceAllStartingAtViewportControlProps,
): JSX.Element | null {
  if (props.viewports.length < 2) return null;
  return (
    <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
      <span>Replace all starting at</span>
      <select
        aria-label="Start replacement at viewport"
        className="h-7 rounded-md border bg-card px-2 text-xs text-foreground"
        onChange={(event) => props.onApplyStartAt(Number(event.target.value))}
        defaultValue=""
      >
        <option value="" disabled>
          Choose...
        </option>
        {props.viewports.map((viewport) => (
          <option key={viewport.index} value={viewport.index}>
            {describeReplacePickerRowLabel(viewport)}
          </option>
        ))}
      </select>
    </div>
  );
}

interface ReplacePickerItemAssignmentListProps {
  items: ReadonlyArray<PendingOpenImageReplaceItem>;
  viewports: ReadonlyArray<OpenImageReplaceTargetEntry>;
  assignments: OpenImagesReplaceAssignment;
  onChoose: (itemIndex: number, targetIndex: number) => void;
}

function ReplacePickerItemAssignmentList(
  props: ReplacePickerItemAssignmentListProps,
): JSX.Element {
  return (
    <div className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
      {props.items.map((item, itemIndex) => (
        <ReplacePickerItemAssignmentRow
          key={`${item.fileName}-${itemIndex}`}
          item={item}
          itemIndex={itemIndex}
          viewports={props.viewports}
          assignedTarget={props.assignments.get(itemIndex) ?? null}
          onChoose={(targetIndex) => props.onChoose(itemIndex, targetIndex)}
        />
      ))}
    </div>
  );
}

interface ReplacePickerItemAssignmentRowProps {
  item: PendingOpenImageReplaceItem;
  itemIndex: number;
  viewports: ReadonlyArray<OpenImageReplaceTargetEntry>;
  assignedTarget: number | null;
  onChoose: (targetIndex: number) => void;
}

function ReplacePickerItemAssignmentRow(
  props: ReplacePickerItemAssignmentRowProps,
): JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded-md border p-2 text-sm">
      <span className="min-w-0 flex-1 truncate" title={props.item.fileName}>
        {props.item.fileName}
      </span>
      <select
        aria-label={`Replacement target for ${props.item.fileName}`}
        value={props.assignedTarget !== null ? String(props.assignedTarget) : ""}
        onChange={(event) => props.onChoose(Number(event.target.value))}
        className="h-7 rounded-md border bg-card px-2 text-xs text-foreground"
      >
        <option value="" disabled>
          Choose viewport...
        </option>
        {props.viewports.map((viewport) => (
          <option key={viewport.index} value={viewport.index}>
            {describeReplacePickerRowLabel(viewport)}
          </option>
        ))}
      </select>
    </div>
  );
}

function describeReplacePickerRowLabel(viewport: OpenImageReplaceTargetEntry): string {
  const number = getViewportNumberFromIndex(viewport.index);
  return `Viewport ${number} (${viewport.fileName})`;
}

function ReplacePickerFooter({
  ready,
  onCancel,
}: {
  ready: boolean;
  onCancel: () => void;
}): JSX.Element {
  return (
    <DialogFooter>
      <Button type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={!ready}>
        Replace
      </Button>
    </DialogFooter>
  );
}
