import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { AlertTriangle, Check, GripVertical, Plus, Trash2 } from "lucide-react";

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
import { findStackedRasterMismatchOrNull } from "@/lib/image/stack-rasters";
import type { RasterImage } from "@/lib/image/raster-image";
import type {
  GroupedOpenedFileRow,
  OpenedFilesGroup,
  OpenedFilesGroupingProposal,
} from "@/lib/image/group-opened-files";
import { cn } from "@/lib/utils";

import { StackThumbnailPreview } from "./stack-thumbnail-preview";

export interface OpenImagesReviewModalProps {
  readonly proposal: OpenedFilesGroupingProposal | null;
  readonly onCancel: () => void;
  readonly onConfirm: (groups: ReadonlyArray<OpenedFilesGroup>) => void;
}

export function OpenImagesReviewModal(props: OpenImagesReviewModalProps): JSX.Element {
  return (
    <Dialog
      open={props.proposal !== null}
      onOpenChange={(open) => dismissModalWhenClosed(open, props.onCancel)}
    >
      <DialogContent className="max-w-3xl">
        {props.proposal ? (
          <OpenImagesReviewBody
            proposal={props.proposal}
            onCancel={props.onCancel}
            onConfirm={props.onConfirm}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function dismissModalWhenClosed(open: boolean, onCancel: () => void): void {
  if (!open) onCancel();
}

type GroupSortBy = "wavelength" | "filename" | "dateModified" | "custom";

interface ReviewGroupViewModel {
  readonly id: string;
  readonly mode: OpenedFilesGroup["mode"];
  readonly rows: ReadonlyArray<GroupedOpenedFileRow>;
  readonly sortBy: GroupSortBy;
  readonly hadConfidentWavelengthParse: boolean;
}

interface OpenImagesReviewBodyProps {
  readonly proposal: OpenedFilesGroupingProposal;
  readonly onCancel: () => void;
  readonly onConfirm: (groups: ReadonlyArray<OpenedFilesGroup>) => void;
}

function OpenImagesReviewBody(props: OpenImagesReviewBodyProps): JSX.Element {
  const [groups, setGroups] = useState<ReadonlyArray<ReviewGroupViewModel>>(() =>
    props.proposal.groups.map(convertGroupingToViewModel),
  );
  const dragHandlers = useDragBetweenGroupsHandlers(groups, setGroups);
  return (
    <>
      <OpenImagesReviewHeader totalRows={countTotalRowsAcrossGroups(groups)} />
      <OpenImagesReviewGroupList
        groups={groups}
        setGroups={setGroups}
        dragHandlers={dragHandlers}
      />
      <AddNewStackGroupButton onAdd={() => setGroups(appendEmptyStackGroup(groups))} />
      <OpenImagesReviewFooter
        groups={groups}
        onCancel={props.onCancel}
        onConfirm={() => props.onConfirm(convertViewModelsToGroups(groups))}
      />
    </>
  );
}

function convertGroupingToViewModel(group: OpenedFilesGroup): ReviewGroupViewModel {
  return {
    id: group.id,
    mode: group.mode,
    rows: group.rows,
    sortBy: group.hadConfidentWavelengthParse ? "wavelength" : "filename",
    hadConfidentWavelengthParse: group.hadConfidentWavelengthParse,
  };
}

function convertViewModelsToGroups(
  models: ReadonlyArray<ReviewGroupViewModel>,
): ReadonlyArray<OpenedFilesGroup> {
  return models
    .filter((model) => model.rows.length > 0)
    .map((model) => ({
      id: model.id,
      mode: model.mode,
      rows: model.rows,
      hadConfidentWavelengthParse: model.hadConfidentWavelengthParse,
    }));
}

function countTotalRowsAcrossGroups(
  groups: ReadonlyArray<ReviewGroupViewModel>,
): number {
  return groups.reduce((sum, group) => sum + group.rows.length, 0);
}

function appendEmptyStackGroup(
  groups: ReadonlyArray<ReviewGroupViewModel>,
): ReadonlyArray<ReviewGroupViewModel> {
  return [
    ...groups,
    {
      id: `stack-${groups.length + 1}-${Date.now()}`,
      mode: "stack",
      rows: [],
      sortBy: "custom",
      hadConfidentWavelengthParse: false,
    },
  ];
}

function OpenImagesReviewHeader({ totalRows }: { totalRows: number }): JSX.Element {
  return (
    <DialogHeader>
      <DialogTitle>Review images</DialogTitle>
      <DialogDescription>
        {`Choose how to open ${totalRows} files. Drag rows to reorder within a group, or between groups.`}
      </DialogDescription>
    </DialogHeader>
  );
}

interface DragBetweenGroupsHandlers {
  readonly onRowDragStart: (groupId: string, rowIndex: number) => void;
  readonly onRowDropAtRow: (targetGroupId: string, targetRowIndex: number) => void;
  readonly onRowDropAtEnd: (targetGroupId: string) => void;
}

function useDragBetweenGroupsHandlers(
  groups: ReadonlyArray<ReviewGroupViewModel>,
  setGroups: (next: ReadonlyArray<ReviewGroupViewModel>) => void,
): DragBetweenGroupsHandlers {
  const dragSourceRef = useRef<{ groupId: string; rowIndex: number } | null>(null);
  const onRowDragStart = useCallback((groupId: string, rowIndex: number) => {
    dragSourceRef.current = { groupId, rowIndex };
  }, []);
  const onRowDropAtRow = useCallback(
    (targetGroupId: string, targetRowIndex: number) => {
      runDropAtRowWithDragRef(dragSourceRef, targetGroupId, targetRowIndex, groups, setGroups);
    },
    [groups, setGroups],
  );
  const onRowDropAtEnd = useCallback(
    (targetGroupId: string) => {
      runDropAtEndWithDragRef(dragSourceRef, targetGroupId, groups, setGroups);
    },
    [groups, setGroups],
  );
  return { onRowDragStart, onRowDropAtRow, onRowDropAtEnd };
}

function runDropAtRowWithDragRef(
  dragSourceRef: React.MutableRefObject<{ groupId: string; rowIndex: number } | null>,
  targetGroupId: string,
  targetRowIndex: number,
  groups: ReadonlyArray<ReviewGroupViewModel>,
  setGroups: (next: ReadonlyArray<ReviewGroupViewModel>) => void,
): void {
  const source = dragSourceRef.current;
  if (!source) return;
  dragSourceRef.current = null;
  setGroups(moveRowAcrossGroups(groups, source, { groupId: targetGroupId, rowIndex: targetRowIndex }));
}

function runDropAtEndWithDragRef(
  dragSourceRef: React.MutableRefObject<{ groupId: string; rowIndex: number } | null>,
  targetGroupId: string,
  groups: ReadonlyArray<ReviewGroupViewModel>,
  setGroups: (next: ReadonlyArray<ReviewGroupViewModel>) => void,
): void {
  const source = dragSourceRef.current;
  if (!source) return;
  dragSourceRef.current = null;
  const targetGroup = groups.find((group) => group.id === targetGroupId);
  if (!targetGroup) return;
  setGroups(
    moveRowAcrossGroups(groups, source, { groupId: targetGroupId, rowIndex: targetGroup.rows.length }),
  );
}

interface DragEndpoint {
  readonly groupId: string;
  readonly rowIndex: number;
}

function moveRowAcrossGroups(
  groups: ReadonlyArray<ReviewGroupViewModel>,
  source: DragEndpoint,
  target: DragEndpoint,
): ReadonlyArray<ReviewGroupViewModel> {
  const sourceGroup = groups.find((g) => g.id === source.groupId);
  if (!sourceGroup) return groups;
  const movingRow = sourceGroup.rows[source.rowIndex];
  if (!movingRow) return groups;
  const isSameGroupAndPosition =
    source.groupId === target.groupId && source.rowIndex === target.rowIndex;
  if (isSameGroupAndPosition) return groups;
  return applyRowMoveAcrossGroups(groups, source, target, movingRow);
}

function applyRowMoveAcrossGroups(
  groups: ReadonlyArray<ReviewGroupViewModel>,
  source: DragEndpoint,
  target: DragEndpoint,
  movingRow: GroupedOpenedFileRow,
): ReadonlyArray<ReviewGroupViewModel> {
  return groups.map((group) =>
    applyRowMoveStepToGroup(group, source, target, movingRow),
  );
}

function applyRowMoveStepToGroup(
  group: ReviewGroupViewModel,
  source: DragEndpoint,
  target: DragEndpoint,
  movingRow: GroupedOpenedFileRow,
): ReviewGroupViewModel {
  const stripped = group.id === source.groupId
    ? stripRowAtIndexFromGroup(group, source.rowIndex)
    : group;
  if (stripped.id !== target.groupId) return stripped;
  return insertRowIntoGroupAtIndex(stripped, movingRow, target.rowIndex, source.groupId);
}

function stripRowAtIndexFromGroup(
  group: ReviewGroupViewModel,
  rowIndex: number,
): ReviewGroupViewModel {
  return { ...group, rows: group.rows.filter((_, index) => index !== rowIndex), sortBy: "custom" };
}

function insertRowIntoGroupAtIndex(
  group: ReviewGroupViewModel,
  row: GroupedOpenedFileRow,
  rowIndex: number,
  sourceGroupId: string,
): ReviewGroupViewModel {
  const clampedIndex = Math.max(0, Math.min(rowIndex, group.rows.length));
  const inserted = [
    ...group.rows.slice(0, clampedIndex),
    row,
    ...group.rows.slice(clampedIndex),
  ];
  const nextSortBy: GroupSortBy = sourceGroupId === group.id ? "custom" : "custom";
  return { ...group, rows: inserted, sortBy: nextSortBy };
}

interface OpenImagesReviewGroupListProps {
  readonly groups: ReadonlyArray<ReviewGroupViewModel>;
  readonly setGroups: (next: ReadonlyArray<ReviewGroupViewModel>) => void;
  readonly dragHandlers: DragBetweenGroupsHandlers;
}

function OpenImagesReviewGroupList(props: OpenImagesReviewGroupListProps): JSX.Element {
  return (
    <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
      {props.groups.map((group) => (
        <OpenImagesReviewGroupCard
          key={group.id}
          group={group}
          onUpdateGroup={(next) => props.setGroups(replaceGroupById(props.groups, group.id, next))}
          onRemoveGroup={() => props.setGroups(removeGroupById(props.groups, group.id))}
          dragHandlers={props.dragHandlers}
        />
      ))}
    </div>
  );
}

function replaceGroupById(
  groups: ReadonlyArray<ReviewGroupViewModel>,
  id: string,
  next: ReviewGroupViewModel,
): ReadonlyArray<ReviewGroupViewModel> {
  return groups.map((group) => (group.id === id ? next : group));
}

function removeGroupById(
  groups: ReadonlyArray<ReviewGroupViewModel>,
  id: string,
): ReadonlyArray<ReviewGroupViewModel> {
  return groups.filter((group) => group.id !== id);
}

interface OpenImagesReviewGroupCardProps {
  readonly group: ReviewGroupViewModel;
  readonly onUpdateGroup: (next: ReviewGroupViewModel) => void;
  readonly onRemoveGroup: () => void;
  readonly dragHandlers: DragBetweenGroupsHandlers;
}

function OpenImagesReviewGroupCard(props: OpenImagesReviewGroupCardProps): JSX.Element {
  const validation = useMemo(
    () => buildValidationStatesForGroup(props.group),
    [props.group],
  );
  return (
    <section
      aria-label={describeGroupAriaLabel(props.group)}
      className="rounded-md border bg-card p-2"
      onDragOver={(event) => event.preventDefault()}
      onDrop={() => props.dragHandlers.onRowDropAtEnd(props.group.id)}
    >
      <OpenImagesReviewGroupCardHeader
        group={props.group}
        onUpdateGroup={props.onUpdateGroup}
        onRemoveGroup={props.onRemoveGroup}
        canSwitchModes={canSwitchGroupToStackMode(props.group, validation)}
      />
      {props.group.mode === "stack" ? (
        <GroupSortBySegmentedControl group={props.group} onUpdateGroup={props.onUpdateGroup} />
      ) : null}
      <OpenImagesReviewGroupRowList
        group={props.group}
        validation={validation}
        onUpdateGroup={props.onUpdateGroup}
        dragHandlers={props.dragHandlers}
      />
    </section>
  );
}

function describeGroupAriaLabel(group: ReviewGroupViewModel): string {
  if (group.mode === "stack") {
    return `Stack group ${group.id} (${group.rows.length} rows)`;
  }
  return `Singles group (${group.rows.length} rows)`;
}

interface GroupValidationSummary {
  readonly perRow: ReadonlyArray<RowValidationState>;
  readonly canStack: boolean;
  readonly disabledStackReason: string | null;
}

type RowValidationState =
  | { readonly kind: "valid" }
  | { readonly kind: "decode-failed"; readonly message: string }
  | { readonly kind: "already-multi-band"; readonly bandCount: number }
  | {
      readonly kind: "property-mismatch";
      readonly propertyName: string;
      readonly message: string;
    };

function buildValidationStatesForGroup(group: ReviewGroupViewModel): GroupValidationSummary {
  const perRow = computePerRowValidationStates(group.rows);
  const canStack = canGroupBeStacked(group.rows, perRow);
  const disabledStackReason = canStack
    ? null
    : describeStackDisabledReason(group.rows, perRow);
  return { perRow, canStack, disabledStackReason };
}

function computePerRowValidationStates(
  rows: ReadonlyArray<GroupedOpenedFileRow>,
): ReadonlyArray<RowValidationState> {
  const baseline = pickFirstStackableRasterBaseline(rows);
  return rows.map((row) => deriveRowValidationState(row, baseline));
}

function pickFirstStackableRasterBaseline(
  rows: ReadonlyArray<GroupedOpenedFileRow>,
): RasterImage | null {
  for (const row of rows) {
    if (row.decodeError !== null) continue;
    if (row.source === null) continue;
    if (row.source.kind !== "raster") continue;
    if (row.source.raster.bandCount !== 1) continue;
    return row.source.raster;
  }
  return null;
}

function deriveRowValidationState(
  row: GroupedOpenedFileRow,
  baseline: RasterImage | null,
): RowValidationState {
  if (row.decodeError !== null) return { kind: "decode-failed", message: row.decodeError };
  if (row.source === null) return { kind: "decode-failed", message: "Failed to decode" };
  if (row.source.kind !== "raster") return { kind: "already-multi-band", bandCount: 1 };
  if (row.source.raster.bandCount > 1) {
    return { kind: "already-multi-band", bandCount: row.source.raster.bandCount };
  }
  return checkAgainstBaselineOrReturnValid(row.source.raster, baseline);
}

function checkAgainstBaselineOrReturnValid(
  candidate: RasterImage,
  baseline: RasterImage | null,
): RowValidationState {
  if (baseline === null) return { kind: "valid" };
  const mismatch = findStackedRasterMismatchOrNull(baseline, candidate);
  if (mismatch === null) return { kind: "valid" };
  return {
    kind: "property-mismatch",
    propertyName: mismatch.propertyName,
    message: `${mismatch.propertyName} ${String(mismatch.observedValue)} differs from baseline ${String(mismatch.baselineValue)}`,
  };
}

function canGroupBeStacked(
  rows: ReadonlyArray<GroupedOpenedFileRow>,
  perRow: ReadonlyArray<RowValidationState>,
): boolean {
  if (rows.length < 2) return false;
  return perRow.every((state) => state.kind === "valid");
}

function describeStackDisabledReason(
  rows: ReadonlyArray<GroupedOpenedFileRow>,
  perRow: ReadonlyArray<RowValidationState>,
): string {
  if (rows.length < 2) return "Stacks need at least 2 rows";
  if (perRow.some((state) => state.kind === "decode-failed")) return "One or more rows failed to decode";
  if (perRow.some((state) => state.kind === "already-multi-band")) return "Multi-band rasters cannot stack";
  if (perRow.some((state) => state.kind === "property-mismatch")) return "Row dimensions or formats do not match";
  return "Not stackable";
}

function canSwitchGroupToStackMode(
  group: ReviewGroupViewModel,
  validation: GroupValidationSummary,
): boolean {
  if (group.mode === "stack") return true;
  return validation.canStack;
}

interface OpenImagesReviewGroupCardHeaderProps {
  readonly group: ReviewGroupViewModel;
  readonly onUpdateGroup: (next: ReviewGroupViewModel) => void;
  readonly onRemoveGroup: () => void;
  readonly canSwitchModes: boolean;
}

function OpenImagesReviewGroupCardHeader(
  props: OpenImagesReviewGroupCardHeaderProps,
): JSX.Element {
  const title = pickGroupTitle(props.group);
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="flex-1 truncate text-sm font-medium">{title}</span>
      <GroupModeDropdown
        group={props.group}
        onUpdateGroup={props.onUpdateGroup}
        canSwitchToStack={props.canSwitchModes}
      />
      <RemoveGroupButton onRemoveGroup={props.onRemoveGroup} />
    </div>
  );
}

function pickGroupTitle(group: ReviewGroupViewModel): string {
  if (group.rows.length === 0) return "Empty stack group";
  if (group.mode === "singles" && group.rows.length === 1) {
    return group.rows[0]!.fileName;
  }
  return group.id;
}

interface GroupModeDropdownProps {
  readonly group: ReviewGroupViewModel;
  readonly onUpdateGroup: (next: ReviewGroupViewModel) => void;
  readonly canSwitchToStack: boolean;
}

function GroupModeDropdown(props: GroupModeDropdownProps): JSX.Element {
  const tooltip = props.canSwitchToStack ? null : "Group is not stackable";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <GroupModeNativeSelect
            group={props.group}
            onUpdateGroup={props.onUpdateGroup}
            canSwitchToStack={props.canSwitchToStack}
          />
        </span>
      </TooltipTrigger>
      {tooltip ? <TooltipContent>{tooltip}</TooltipContent> : null}
    </Tooltip>
  );
}

function GroupModeNativeSelect(props: GroupModeDropdownProps): JSX.Element {
  return (
    <select
      aria-label="Group mode"
      value={props.group.mode}
      onChange={(event) =>
        props.onUpdateGroup({
          ...props.group,
          mode: event.target.value as OpenedFilesGroup["mode"],
        })
      }
      className="h-8 w-44 rounded-md border bg-card px-2 text-xs text-foreground"
    >
      <option value="stack" disabled={!props.canSwitchToStack}>
        Stack
      </option>
      <option value="singles">Open as separate images</option>
    </select>
  );
}

function RemoveGroupButton({ onRemoveGroup }: { onRemoveGroup: () => void }): JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Remove group"
      className="size-8 text-muted-foreground"
      onClick={onRemoveGroup}
    >
      <Trash2 className="size-4" />
    </Button>
  );
}

interface GroupSortBySegmentedControlProps {
  readonly group: ReviewGroupViewModel;
  readonly onUpdateGroup: (next: ReviewGroupViewModel) => void;
}

function GroupSortBySegmentedControl(
  props: GroupSortBySegmentedControlProps,
): JSX.Element {
  return (
    <div role="radiogroup" aria-label="Sort by" className="mb-2 flex items-center gap-1 text-xs">
      <span className="mr-1 text-muted-foreground">Sort by</span>
      {GROUP_SORT_BY_OPTIONS.map((option) => (
        <GroupSortByPill
          key={option.value}
          option={option}
          isActive={props.group.sortBy === option.value}
          isDisabled={isSortByDisabledForGroup(option.value, props.group)}
          onSelect={() => applySortByChoiceToGroup(option.value, props.group, props.onUpdateGroup)}
        />
      ))}
    </div>
  );
}

interface GroupSortByOption {
  readonly value: GroupSortBy;
  readonly label: string;
}

const GROUP_SORT_BY_OPTIONS: ReadonlyArray<GroupSortByOption> = [
  { value: "wavelength", label: "Wavelength" },
  { value: "filename", label: "Filename" },
  { value: "dateModified", label: "Date modified" },
  { value: "custom", label: "Custom" },
];

function isSortByDisabledForGroup(option: GroupSortBy, group: ReviewGroupViewModel): boolean {
  return option === "wavelength" && !group.hadConfidentWavelengthParse;
}

function applySortByChoiceToGroup(
  next: GroupSortBy,
  group: ReviewGroupViewModel,
  onUpdateGroup: (next: ReviewGroupViewModel) => void,
): void {
  if (next === "custom") {
    onUpdateGroup({ ...group, sortBy: next });
    return;
  }
  onUpdateGroup({ ...group, sortBy: next, rows: sortRowsByChoice(next, group.rows) });
}

function sortRowsByChoice(
  sortBy: GroupSortBy,
  rows: ReadonlyArray<GroupedOpenedFileRow>,
): ReadonlyArray<GroupedOpenedFileRow> {
  if (sortBy === "wavelength") {
    return [...rows].sort((a, b) => (a.wavelength ?? Infinity) - (b.wavelength ?? Infinity));
  }
  if (sortBy === "filename") {
    return [...rows].sort((a, b) => a.fileName.localeCompare(b.fileName));
  }
  if (sortBy === "dateModified") return [...rows].sort((a, b) => a.mtimeMs - b.mtimeMs);
  return rows;
}

interface GroupSortByPillProps {
  readonly option: GroupSortByOption;
  readonly isActive: boolean;
  readonly isDisabled: boolean;
  readonly onSelect: () => void;
}

function GroupSortByPill(props: GroupSortByPillProps): JSX.Element {
  return (
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
}

interface OpenImagesReviewGroupRowListProps {
  readonly group: ReviewGroupViewModel;
  readonly validation: GroupValidationSummary;
  readonly onUpdateGroup: (next: ReviewGroupViewModel) => void;
  readonly dragHandlers: DragBetweenGroupsHandlers;
}

function OpenImagesReviewGroupRowList(
  props: OpenImagesReviewGroupRowListProps,
): JSX.Element {
  if (props.group.rows.length === 0) {
    return <EmptyGroupHint />;
  }
  return (
    <ul role="list" className="flex flex-col gap-1">
      {props.group.rows.map((row, index) => (
        <OpenImagesReviewRow
          key={row.contentHash + index}
          row={row}
          rowIndex={index}
          totalRows={props.group.rows.length}
          group={props.group}
          validationState={props.validation.perRow[index] ?? { kind: "valid" }}
          onReorderWithinGroup={(targetIndex) =>
            applyReorderWithinGroup(props.group, index, targetIndex, props.onUpdateGroup)
          }
          dragHandlers={props.dragHandlers}
        />
      ))}
    </ul>
  );
}

function EmptyGroupHint(): JSX.Element {
  return (
    <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
      Drop rows here to add them to this stack.
    </div>
  );
}

function applyReorderWithinGroup(
  group: ReviewGroupViewModel,
  sourceIndex: number,
  targetIndex: number,
  onUpdateGroup: (next: ReviewGroupViewModel) => void,
): void {
  const next = moveRowWithinGroupRows(group.rows, sourceIndex, targetIndex);
  onUpdateGroup({ ...group, rows: next, sortBy: "custom" });
}

function moveRowWithinGroupRows(
  rows: ReadonlyArray<GroupedOpenedFileRow>,
  sourceIndex: number,
  targetIndex: number,
): ReadonlyArray<GroupedOpenedFileRow> {
  if (sourceIndex === targetIndex) return rows;
  const moving = rows[sourceIndex];
  if (!moving) return rows;
  const withoutSource = rows.filter((_, index) => index !== sourceIndex);
  const clamped = Math.max(0, Math.min(targetIndex, withoutSource.length));
  return [...withoutSource.slice(0, clamped), moving, ...withoutSource.slice(clamped)];
}

interface OpenImagesReviewRowProps {
  readonly row: GroupedOpenedFileRow;
  readonly rowIndex: number;
  readonly totalRows: number;
  readonly group: ReviewGroupViewModel;
  readonly validationState: RowValidationState;
  readonly onReorderWithinGroup: (targetIndex: number) => void;
  readonly dragHandlers: DragBetweenGroupsHandlers;
}

function OpenImagesReviewRow(props: OpenImagesReviewRowProps): JSX.Element {
  const [isDragOver, setIsDragOver] = useState(false);
  return (
    <li
      draggable
      onDragStart={() => props.dragHandlers.onRowDragStart(props.group.id, props.rowIndex)}
      onDragOver={(event) => handleRowDragOver(event, setIsDragOver)}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(event) => handleRowDrop(event, props, setIsDragOver)}
      onKeyDown={(event) => handleRowKeyDown(event, props.rowIndex, props.onReorderWithinGroup, props.totalRows)}
      tabIndex={0}
      aria-label={describeRowAriaLabel(props.row, props.rowIndex, props.totalRows)}
      className={cn(
        "flex items-center gap-3 rounded-md border border-transparent bg-card p-2 text-sm",
        "focus:outline-none focus:ring-2 focus:ring-ring",
        isDragOver && "border-primary",
      )}
    >
      <RowDragHandle />
      <StackThumbnailPreview raster={pickRowRasterOrNull(props.row)} sizePx={48} />
      <RowMainContent row={props.row} validationState={props.validationState} />
    </li>
  );
}

function handleRowDragOver(
  event: React.DragEvent<HTMLLIElement>,
  setIsDragOver: (next: boolean) => void,
): void {
  event.preventDefault();
  event.stopPropagation();
  setIsDragOver(true);
}

function handleRowDrop(
  event: React.DragEvent<HTMLLIElement>,
  props: OpenImagesReviewRowProps,
  setIsDragOver: (next: boolean) => void,
): void {
  event.preventDefault();
  event.stopPropagation();
  setIsDragOver(false);
  props.dragHandlers.onRowDropAtRow(props.group.id, props.rowIndex);
}

function handleRowKeyDown(
  event: KeyboardEvent<HTMLLIElement>,
  index: number,
  onReorderWithinGroup: (targetIndex: number) => void,
  totalRows: number,
): void {
  if (!event.altKey) return;
  if (event.key === "ArrowUp" && index > 0) {
    event.preventDefault();
    onReorderWithinGroup(index - 1);
    return;
  }
  if (event.key === "ArrowDown" && index < totalRows - 1) {
    event.preventDefault();
    onReorderWithinGroup(index + 1);
  }
}

function describeRowAriaLabel(
  row: GroupedOpenedFileRow,
  index: number,
  totalRows: number,
): string {
  return `Row ${index + 1} of ${totalRows}: ${row.fileName}`;
}

function pickRowRasterOrNull(row: GroupedOpenedFileRow): RasterImage | null {
  if (row.source === null) return null;
  if (row.source.kind !== "raster") return null;
  return row.source.raster;
}

function RowDragHandle(): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="flex size-6 shrink-0 cursor-grab items-center justify-center text-muted-foreground"
    >
      <GripVertical className="size-4" />
    </span>
  );
}

interface RowMainContentProps {
  readonly row: GroupedOpenedFileRow;
  readonly validationState: RowValidationState;
}

function RowMainContent(props: RowMainContentProps): JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <RowFileNameWithEmphasis row={props.row} />
        <RowMetadataLine row={props.row} />
      </div>
      <RowValidationBadge state={props.validationState} />
    </div>
  );
}

function RowFileNameWithEmphasis({ row }: { row: GroupedOpenedFileRow }): JSX.Element {
  const { prefix, middle, suffix } = splitFileNameByDifferentiatingMiddle(row);
  return (
    <p className="truncate text-sm">
      <span className="text-muted-foreground">{prefix}</span>
      <span className="font-medium text-foreground">{middle}</span>
      <span className="text-muted-foreground">{suffix}</span>
    </p>
  );
}

function splitFileNameByDifferentiatingMiddle(row: GroupedOpenedFileRow): {
  prefix: string;
  middle: string;
  suffix: string;
} {
  const middleIndex = row.fileName.indexOf(row.differentiatingSubstring);
  if (middleIndex < 0 || row.differentiatingSubstring === row.fileName) {
    return { prefix: "", middle: row.fileName, suffix: "" };
  }
  return {
    prefix: row.fileName.slice(0, middleIndex),
    middle: row.differentiatingSubstring,
    suffix: row.fileName.slice(middleIndex + row.differentiatingSubstring.length),
  };
}

function RowMetadataLine({ row }: { row: GroupedOpenedFileRow }): JSX.Element {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {row.wavelength !== null ? <RowWavelengthBadge wavelength={row.wavelength} /> : null}
      <span>{formatFileSizeAsMegabytes(row.fileSizeBytes)}</span>
    </div>
  );
}

function RowWavelengthBadge({ wavelength }: { wavelength: number }): JSX.Element {
  return (
    <span className="rounded-full bg-sky-500/15 px-2 py-0.5 font-medium text-sky-400">
      {`${wavelength} nm`}
    </span>
  );
}

function formatFileSizeAsMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function RowValidationBadge({ state }: { state: RowValidationState }): JSX.Element {
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

function ValidationErrorBadge({ state }: { state: RowValidationState }): JSX.Element {
  const message = describeRowValidationErrorTooltip(state);
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

function describeRowValidationErrorTooltip(state: RowValidationState): string {
  if (state.kind === "valid") return "";
  if (state.kind === "decode-failed") return state.message;
  if (state.kind === "already-multi-band") {
    return `Multi-band raster (${state.bandCount} bands); will open as its own image`;
  }
  return state.message;
}

interface AddNewStackGroupButtonProps {
  readonly onAdd: () => void;
}

function AddNewStackGroupButton(props: AddNewStackGroupButtonProps): JSX.Element {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="self-start"
      onClick={props.onAdd}
    >
      <Plus className="mr-2 size-4" /> New stack
    </Button>
  );
}

interface OpenImagesReviewFooterProps {
  readonly groups: ReadonlyArray<ReviewGroupViewModel>;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

function OpenImagesReviewFooter(props: OpenImagesReviewFooterProps): JSX.Element {
  const canConfirm = canConfirmAllGroupsValid(props.groups);
  return (
    <DialogFooter>
      <Button type="button" variant="ghost" onClick={props.onCancel}>
        Cancel
      </Button>
      <Button type="button" disabled={!canConfirm} onClick={props.onConfirm}>
        {buildConfirmButtonLabelForGroups(props.groups)}
      </Button>
    </DialogFooter>
  );
}

function canConfirmAllGroupsValid(
  groups: ReadonlyArray<ReviewGroupViewModel>,
): boolean {
  for (const group of groups) {
    if (group.rows.length === 0) return false;
    if (group.mode === "stack" && !buildValidationStatesForGroup(group).canStack) return false;
  }
  return groups.length > 0;
}

function buildConfirmButtonLabelForGroups(
  groups: ReadonlyArray<ReviewGroupViewModel>,
): string {
  const stackCount = groups.filter((group) => group.mode === "stack").length;
  const singleCount = groups.reduce(
    (sum, group) => sum + (group.mode === "singles" ? group.rows.length : 0),
    0,
  );
  return formatConfirmButtonLabelFromCounts(stackCount, singleCount);
}

function formatConfirmButtonLabelFromCounts(
  stackCount: number,
  singleCount: number,
): string {
  const parts: string[] = [];
  if (stackCount > 0) parts.push(`${stackCount} ${stackCount === 1 ? "stack" : "stacks"}`);
  if (singleCount > 0) parts.push(`${singleCount} ${singleCount === 1 ? "image" : "images"}`);
  if (parts.length === 0) return "Open";
  return `Open ${parts.join(" + ")}`;
}
