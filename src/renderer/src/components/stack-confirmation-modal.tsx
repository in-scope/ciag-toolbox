import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AlertTriangle, Check, GripVertical } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  buildStackEntryValidationStatesInDisplayOrder,
  describeMultiPageValidationError,
  isValidationStateExcludedFromStack,
} from "@/lib/image/compute-stack-row-validation";
import type {
  DecodedStackEntry,
  PendingOpenImageStack,
  StackEntryValidationState,
} from "@/lib/image/open-image-stack-types";
import { cn } from "@/lib/utils";

import { StackThumbnailPreview } from "./stack-thumbnail-preview";

export type StackSortBy = "wavelength" | "filename" | "dateModified" | "custom";

interface StackConfirmationModalProps {
  readonly pending: PendingOpenImageStack | null;
  readonly onCancel: () => void;
  readonly onConfirm: (orderedIncludedEntries: ReadonlyArray<DecodedStackEntry>) => void;
}

export function StackConfirmationModal(props: StackConfirmationModalProps): JSX.Element {
  return (
    <Dialog
      open={props.pending !== null}
      onOpenChange={(open) => closeStackModalWhenDismissed(open, props.onCancel)}
    >
      <DialogContent className="max-w-3xl">
        {props.pending ? (
          <StackConfirmationBody
            pending={props.pending}
            onCancel={props.onCancel}
            onConfirm={props.onConfirm}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function closeStackModalWhenDismissed(open: boolean, onCancel: () => void): void {
  if (!open) onCancel();
}

interface StackConfirmationBodyProps {
  readonly pending: PendingOpenImageStack;
  readonly onCancel: () => void;
  readonly onConfirm: (orderedIncludedEntries: ReadonlyArray<DecodedStackEntry>) => void;
}

function StackConfirmationBody(props: StackConfirmationBodyProps): JSX.Element {
  const initialSort = pickInitialStackSortBy(props.pending);
  const [sortBy, setSortBy] = useState<StackSortBy>(initialSort);
  const [orderedFileNames, setOrderedFileNames] = useState<ReadonlyArray<string>>(() =>
    props.pending.entries.map((entry) => entry.fileName),
  );
  const orderedEntries = useMemo(
    () => mapOrderedFileNamesToEntries(orderedFileNames, props.pending.entries),
    [orderedFileNames, props.pending.entries],
  );
  const validationStates = useMemo(
    () => buildStackEntryValidationStatesInDisplayOrder(orderedEntries),
    [orderedEntries],
  );
  return (
    <StackConfirmationBodyChrome
      pending={props.pending}
      sortBy={sortBy}
      orderedEntries={orderedEntries}
      validationStates={validationStates}
      onChangeSortBy={(next) => handleSortByChange(next, props.pending, setSortBy, setOrderedFileNames)}
      onReorder={(next) => handleManualReorder(next, setSortBy, setOrderedFileNames)}
      onCancel={props.onCancel}
      onConfirm={() => props.onConfirm(filterEntriesToValid(orderedEntries, validationStates))}
    />
  );
}

interface StackConfirmationBodyChromeProps {
  readonly pending: PendingOpenImageStack;
  readonly sortBy: StackSortBy;
  readonly orderedEntries: ReadonlyArray<DecodedStackEntry>;
  readonly validationStates: ReadonlyArray<StackEntryValidationState>;
  readonly onChangeSortBy: (next: StackSortBy) => void;
  readonly onReorder: (next: ReadonlyArray<string>) => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

function StackConfirmationBodyChrome(props: StackConfirmationBodyChromeProps): JSX.Element {
  return (
    <>
      <StackConfirmationHeader entryCount={props.pending.entries.length} />
      <StackSortBySegmentedControl
        sortBy={props.sortBy}
        canSortByWavelength={props.pending.hadConfidentWavelengthParse}
        onChange={props.onChangeSortBy}
      />
      <StackEntryList
        entries={props.orderedEntries}
        validationStates={props.validationStates}
        onReorder={props.onReorder}
      />
      <StackConfirmationFooter
        validationStates={props.validationStates}
        totalCount={props.orderedEntries.length}
        onCancel={props.onCancel}
        onConfirm={props.onConfirm}
      />
    </>
  );
}

function pickInitialStackSortBy(pending: PendingOpenImageStack): StackSortBy {
  return pending.hadConfidentWavelengthParse ? "wavelength" : "filename";
}

function mapOrderedFileNamesToEntries(
  orderedFileNames: ReadonlyArray<string>,
  entries: ReadonlyArray<DecodedStackEntry>,
): ReadonlyArray<DecodedStackEntry> {
  const byName = new Map(entries.map((entry) => [entry.fileName, entry]));
  const ordered: DecodedStackEntry[] = [];
  for (const name of orderedFileNames) {
    const entry = byName.get(name);
    if (entry) ordered.push(entry);
  }
  return ordered.length === entries.length ? ordered : entries;
}

function handleSortByChange(
  nextSortBy: StackSortBy,
  pending: PendingOpenImageStack,
  setSortBy: (next: StackSortBy) => void,
  setOrderedFileNames: (next: ReadonlyArray<string>) => void,
): void {
  setSortBy(nextSortBy);
  if (nextSortBy === "custom") return;
  setOrderedFileNames(reorderFileNamesBySortChoice(nextSortBy, pending.entries));
}

function handleManualReorder(
  next: ReadonlyArray<string>,
  setSortBy: (next: StackSortBy) => void,
  setOrderedFileNames: (next: ReadonlyArray<string>) => void,
): void {
  setSortBy("custom");
  setOrderedFileNames(next);
}

function reorderFileNamesBySortChoice(
  sortBy: StackSortBy,
  entries: ReadonlyArray<DecodedStackEntry>,
): ReadonlyArray<string> {
  if (sortBy === "wavelength") return sortEntryFileNamesByWavelength(entries);
  if (sortBy === "filename") return sortEntryFileNamesAlphabetically(entries);
  if (sortBy === "dateModified") return sortEntryFileNamesByMtimeAscending(entries);
  return entries.map((entry) => entry.fileName);
}

function sortEntryFileNamesByWavelength(
  entries: ReadonlyArray<DecodedStackEntry>,
): ReadonlyArray<string> {
  return [...entries]
    .sort((a, b) => (a.wavelength ?? Infinity) - (b.wavelength ?? Infinity))
    .map((entry) => entry.fileName);
}

function sortEntryFileNamesAlphabetically(
  entries: ReadonlyArray<DecodedStackEntry>,
): ReadonlyArray<string> {
  return [...entries].sort((a, b) => a.fileName.localeCompare(b.fileName)).map((entry) => entry.fileName);
}

function sortEntryFileNamesByMtimeAscending(
  entries: ReadonlyArray<DecodedStackEntry>,
): ReadonlyArray<string> {
  return [...entries].sort((a, b) => a.mtimeMs - b.mtimeMs).map((entry) => entry.fileName);
}

function filterEntriesToValid(
  orderedEntries: ReadonlyArray<DecodedStackEntry>,
  states: ReadonlyArray<StackEntryValidationState>,
): ReadonlyArray<DecodedStackEntry> {
  return orderedEntries.filter((_, index) => {
    const state = states[index];
    return state !== undefined && !isValidationStateExcludedFromStack(state);
  });
}

function StackConfirmationHeader({ entryCount }: { entryCount: number }): JSX.Element {
  return (
    <DialogHeader>
      <DialogTitle>Confirm image stack</DialogTitle>
      <DialogDescription>
        {`Reorder and review ${entryCount} TIFFs before stacking them into a single multi-band raster.`}
      </DialogDescription>
    </DialogHeader>
  );
}

interface StackSortBySegmentedControlProps {
  readonly sortBy: StackSortBy;
  readonly canSortByWavelength: boolean;
  readonly onChange: (next: StackSortBy) => void;
}

function StackSortBySegmentedControl(props: StackSortBySegmentedControlProps): JSX.Element {
  return (
    <div role="radiogroup" aria-label="Sort by" className="flex items-center gap-1 text-xs">
      <span className="mr-1 text-muted-foreground">Sort by</span>
      {STACK_SORT_BY_OPTIONS.map((option) => (
        <StackSortByPill
          key={option.value}
          option={option}
          isActive={props.sortBy === option.value}
          isDisabled={isSortByWavelengthDisabled(option.value, props.canSortByWavelength)}
          onSelect={() => props.onChange(option.value)}
        />
      ))}
    </div>
  );
}

interface StackSortByOption {
  readonly value: StackSortBy;
  readonly label: string;
}

const STACK_SORT_BY_OPTIONS: ReadonlyArray<StackSortByOption> = [
  { value: "wavelength", label: "Wavelength" },
  { value: "filename", label: "Filename" },
  { value: "dateModified", label: "Date modified" },
  { value: "custom", label: "Custom" },
];

function isSortByWavelengthDisabled(option: StackSortBy, canSortByWavelength: boolean): boolean {
  return option === "wavelength" && !canSortByWavelength;
}

interface StackSortByPillProps {
  readonly option: StackSortByOption;
  readonly isActive: boolean;
  readonly isDisabled: boolean;
  readonly onSelect: () => void;
}

function StackSortByPill(props: StackSortByPillProps): JSX.Element {
  const button = (
    <button
      type="button"
      role="radio"
      aria-checked={props.isActive}
      disabled={props.isDisabled}
      onClick={props.onSelect}
      className={cn(
        "rounded-md border px-2 py-1 text-xs transition-colors",
        props.isActive
          ? "border-primary bg-primary/15 text-primary"
          : "border-transparent text-muted-foreground hover:bg-accent",
        props.isDisabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
      )}
    >
      {props.option.label}
    </button>
  );
  if (!props.isDisabled) return button;
  return wrapPillWithDisabledTooltip(button);
}

function wrapPillWithDisabledTooltip(button: JSX.Element): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{button}</span>
      </TooltipTrigger>
      <TooltipContent>No wavelengths parsed</TooltipContent>
    </Tooltip>
  );
}

interface StackEntryListProps {
  readonly entries: ReadonlyArray<DecodedStackEntry>;
  readonly validationStates: ReadonlyArray<StackEntryValidationState>;
  readonly onReorder: (next: ReadonlyArray<string>) => void;
}

function StackEntryList(props: StackEntryListProps): JSX.Element {
  const dragSourceIndexRef = useRef<number | null>(null);
  const handleDrop = useCallback(
    (sourceIndex: number, targetIndex: number) => {
      if (sourceIndex === targetIndex) return;
      props.onReorder(moveItemAtIndex(props.entries, sourceIndex, targetIndex));
    },
    [props],
  );
  const handleKeyboardReorder = useCallback(
    (currentIndex: number, direction: -1 | 1) => {
      const target = currentIndex + direction;
      if (target < 0 || target >= props.entries.length) return;
      props.onReorder(moveItemAtIndex(props.entries, currentIndex, target));
    },
    [props],
  );
  return (
    <ul role="list" className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto pr-1">
      {props.entries.map((entry, index) => (
        <StackEntryRow
          key={entry.fileName}
          entry={entry}
          index={index}
          totalCount={props.entries.length}
          validationState={props.validationStates[index] ?? { kind: "valid" }}
          dragSourceIndexRef={dragSourceIndexRef}
          onDropAtIndex={(target) => handleDrop(dragSourceIndexRef.current ?? index, target)}
          onKeyboardReorder={handleKeyboardReorder}
        />
      ))}
    </ul>
  );
}

function moveItemAtIndex(
  entries: ReadonlyArray<DecodedStackEntry>,
  sourceIndex: number,
  targetIndex: number,
): ReadonlyArray<string> {
  const fileNames = entries.map((entry) => entry.fileName);
  const source = fileNames[sourceIndex];
  if (source === undefined) return fileNames;
  const without = fileNames.filter((_, index) => index !== sourceIndex);
  const clampedTarget = Math.max(0, Math.min(targetIndex, without.length));
  return [...without.slice(0, clampedTarget), source, ...without.slice(clampedTarget)];
}

interface StackEntryRowProps {
  readonly entry: DecodedStackEntry;
  readonly index: number;
  readonly totalCount: number;
  readonly validationState: StackEntryValidationState;
  readonly dragSourceIndexRef: React.MutableRefObject<number | null>;
  readonly onDropAtIndex: (targetIndex: number) => void;
  readonly onKeyboardReorder: (currentIndex: number, direction: -1 | 1) => void;
}

function StackEntryRow(props: StackEntryRowProps): JSX.Element {
  const [isDragOver, setIsDragOver] = useState(false);
  return (
    <li
      draggable
      onDragStart={() => {
        props.dragSourceIndexRef.current = props.index;
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(event) => handleStackRowDrop(event, props.index, props.onDropAtIndex, setIsDragOver)}
      onKeyDown={(event) => handleStackRowKeyDown(event, props.index, props.onKeyboardReorder)}
      tabIndex={0}
      aria-label={describeStackEntryRowAriaLabel(props.entry, props.index, props.totalCount)}
      className={cn(
        "flex items-center gap-3 rounded-md border border-transparent bg-card p-2 text-sm",
        "focus:outline-none focus:ring-2 focus:ring-ring",
        isDragOver && "border-primary",
      )}
    >
      <StackRowDragHandle />
      <StackThumbnailPreview entry={props.entry} sizePx={64} />
      <StackEntryRowMainContent entry={props.entry} validationState={props.validationState} />
    </li>
  );
}

function handleStackRowDrop(
  event: React.DragEvent<HTMLLIElement>,
  rowIndex: number,
  onDropAtIndex: (targetIndex: number) => void,
  setIsDragOver: (next: boolean) => void,
): void {
  event.preventDefault();
  setIsDragOver(false);
  onDropAtIndex(rowIndex);
}

function handleStackRowKeyDown(
  event: KeyboardEvent<HTMLLIElement>,
  index: number,
  onKeyboardReorder: (currentIndex: number, direction: -1 | 1) => void,
): void {
  if (!event.altKey) return;
  if (event.key === "ArrowUp") {
    event.preventDefault();
    onKeyboardReorder(index, -1);
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    onKeyboardReorder(index, 1);
  }
}

function describeStackEntryRowAriaLabel(
  entry: DecodedStackEntry,
  index: number,
  totalCount: number,
): string {
  return `Stack entry ${index + 1} of ${totalCount}: ${entry.fileName}`;
}

function StackRowDragHandle(): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="flex size-6 shrink-0 cursor-grab items-center justify-center text-muted-foreground"
    >
      <GripVertical className="size-4" />
    </span>
  );
}

interface StackEntryRowMainContentProps {
  readonly entry: DecodedStackEntry;
  readonly validationState: StackEntryValidationState;
}

function StackEntryRowMainContent(props: StackEntryRowMainContentProps): JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <StackEntryFileNameWithEmphasis entry={props.entry} />
        <StackEntryMetadataLine entry={props.entry} />
      </div>
      <StackEntryValidationBadge state={props.validationState} />
    </div>
  );
}

function StackEntryFileNameWithEmphasis({ entry }: { entry: DecodedStackEntry }): JSX.Element {
  const { prefix, middle, suffix } = splitFileNameByDifferentiatingMiddle(entry);
  return (
    <p className="truncate text-sm">
      <span className="text-muted-foreground">{prefix}</span>
      <span className="font-medium text-foreground">{middle}</span>
      <span className="text-muted-foreground">{suffix}</span>
    </p>
  );
}

function splitFileNameByDifferentiatingMiddle(
  entry: DecodedStackEntry,
): { prefix: string; middle: string; suffix: string } {
  const middleIndex = entry.fileName.indexOf(entry.differentiatingSubstring);
  if (middleIndex < 0 || entry.differentiatingSubstring === entry.fileName) {
    return { prefix: "", middle: entry.fileName, suffix: "" };
  }
  return {
    prefix: entry.fileName.slice(0, middleIndex),
    middle: entry.differentiatingSubstring,
    suffix: entry.fileName.slice(middleIndex + entry.differentiatingSubstring.length),
  };
}

function StackEntryMetadataLine({ entry }: { entry: DecodedStackEntry }): JSX.Element {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {entry.wavelength !== null ? <StackWavelengthBadge wavelength={entry.wavelength} /> : null}
      <span>{formatFileSizeAsMegabytes(entry.fileSizeBytes)}</span>
    </div>
  );
}

function StackWavelengthBadge({ wavelength }: { wavelength: number }): JSX.Element {
  return (
    <span className="rounded-full bg-sky-500/15 px-2 py-0.5 font-medium text-sky-400">
      {`${wavelength} nm`}
    </span>
  );
}

function formatFileSizeAsMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StackEntryValidationBadge({ state }: { state: StackEntryValidationState }): JSX.Element {
  if (state.kind === "valid") return <ValidationCheckBadge />;
  return <ValidationErrorBadge state={state} />;
}

function ValidationCheckBadge(): JSX.Element {
  return (
    <span
      aria-label="Compatible"
      className="flex size-6 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400"
    >
      <Check className="size-3.5" />
    </span>
  );
}

function ValidationErrorBadge({ state }: { state: StackEntryValidationState }): JSX.Element {
  const message = describeValidationErrorTooltip(state);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={message}
          className="flex size-6 cursor-help items-center justify-center rounded-full bg-destructive/15 text-destructive"
        >
          <AlertTriangle className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{message}</TooltipContent>
    </Tooltip>
  );
}

function describeValidationErrorTooltip(state: StackEntryValidationState): string {
  if (state.kind === "valid") return "";
  if (state.kind === "decode-failed") return state.message;
  if (state.kind === "multi-page") return describeMultiPageValidationError(state.pageCount);
  return state.message;
}

interface StackConfirmationFooterProps {
  readonly validationStates: ReadonlyArray<StackEntryValidationState>;
  readonly totalCount: number;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

function StackConfirmationFooter(props: StackConfirmationFooterProps): JSX.Element {
  const includedCount = countIncludedRows(props.validationStates);
  const excludedCount = props.totalCount - includedCount;
  const canConfirm = includedCount >= 2;
  return (
    <DialogFooter>
      <Button type="button" variant="ghost" onClick={props.onCancel}>
        Cancel
      </Button>
      <Button type="button" disabled={!canConfirm} onClick={props.onConfirm}>
        {buildConfirmButtonLabel(includedCount, excludedCount)}
      </Button>
    </DialogFooter>
  );
}

function countIncludedRows(states: ReadonlyArray<StackEntryValidationState>): number {
  let count = 0;
  for (const state of states) if (!isValidationStateExcludedFromStack(state)) count += 1;
  return count;
}

function buildConfirmButtonLabel(includedCount: number, excludedCount: number): string {
  if (excludedCount === 0) return `Stack ${includedCount}`;
  return `Stack ${includedCount} (${excludedCount} excluded)`;
}
