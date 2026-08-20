import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { AlertTriangle, Check, GripVertical, Plus, Trash2, Undo2 } from "lucide-react";
import { notifyError } from "@/lib/notifications/notify";

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
import { classifyOpenedRasterByShape } from "@/lib/image/classify-opened-raster";
import { formatFileSizeBytesForDisplay } from "@/lib/image/image-metadata-display";
import { findStackedRasterMismatchOrNull } from "@/lib/image/stack-rasters";
import type { RasterImage } from "@/lib/image/raster-image";
import {
  canRecombineSplitGroupsIntoOriginal,
  replaceSplitGroupsWithRestoredGroup,
  splitGroupRowsIntoSingleImageGroupsWithRecoveryRecord,
} from "@/lib/image/group-opened-files";
import type {
  GroupedOpenedFileRow,
  OpenedFilesGroup,
  OpenedFilesGroupMode,
  OpenedFilesGroupingProposal,
  SplitGroupRecoveryRecord,
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
  const splitRecovery = useSplitRecoveryRecords(groups, setGroups);
  const dragHandlers = useDragBetweenGroupsHandlers(groups, setGroups);
  return (
    <>
      <OpenImagesReviewHeader />
      <OpenImagesReviewGroupList
        groups={groups}
        setGroups={setGroups}
        splitRecovery={splitRecovery}
        dragHandlers={dragHandlers}
      />
      <AddNewImageButton onAdd={() => setGroups(appendEmptyStackGroup(groups))} />
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
  return models.filter((model) => model.rows.length > 0).map(convertViewModelToGroup);
}

function convertViewModelToGroup(model: ReviewGroupViewModel): OpenedFilesGroup {
  return {
    id: model.id,
    mode: model.mode,
    rows: model.rows,
    hadConfidentWavelengthParse: model.hadConfidentWavelengthParse,
  };
}

// CT-264: splitting a group remembers the pre-split grouping so the
// "Recombine into one stack" affordance can restore it exactly; the affordance
// is offered only while every split group still holds its original row.
interface SplitRecoveryApi {
  readonly splitGroupRecordingRecovery: (target: ReviewGroupViewModel) => void;
  readonly recombineSplitGroups: (record: SplitGroupRecoveryRecord) => void;
  readonly recombinableRecordByFirstSplitGroupId: ReadonlyMap<string, SplitGroupRecoveryRecord>;
}

function useSplitRecoveryRecords(
  groups: ReadonlyArray<ReviewGroupViewModel>,
  setGroups: (next: ReadonlyArray<ReviewGroupViewModel>) => void,
): SplitRecoveryApi {
  const [records, setRecords] = useState<ReadonlyArray<SplitGroupRecoveryRecord>>([]);
  return {
    splitGroupRecordingRecovery: (target) =>
      runSplitRecordingRecovery(target, groups, setGroups, records, setRecords),
    recombineSplitGroups: (record) =>
      runRecombineSplitGroups(record, groups, setGroups, records, setRecords),
    recombinableRecordByFirstSplitGroupId: indexRecombinableRecordsByFirstSplitGroupId(
      groups,
      records,
    ),
  };
}

function runSplitRecordingRecovery(
  target: ReviewGroupViewModel,
  groups: ReadonlyArray<ReviewGroupViewModel>,
  setGroups: (next: ReadonlyArray<ReviewGroupViewModel>) => void,
  records: ReadonlyArray<SplitGroupRecoveryRecord>,
  setRecords: (next: ReadonlyArray<SplitGroupRecoveryRecord>) => void,
): void {
  const split = splitGroupRowsIntoSingleImageGroupsWithRecoveryRecord(
    convertViewModelToGroup(target),
  );
  const splitModels = split.splitGroups.map(convertGroupingToViewModel);
  setGroups(groups.flatMap((group) => (group.id === target.id ? splitModels : [group])));
  setRecords([...records, split.recoveryRecord]);
}

function runRecombineSplitGroups(
  record: SplitGroupRecoveryRecord,
  groups: ReadonlyArray<ReviewGroupViewModel>,
  setGroups: (next: ReadonlyArray<ReviewGroupViewModel>) => void,
  records: ReadonlyArray<SplitGroupRecoveryRecord>,
  setRecords: (next: ReadonlyArray<SplitGroupRecoveryRecord>) => void,
): void {
  const restoredModel = convertGroupingToViewModel(record.originalGroup);
  setGroups(replaceSplitGroupsWithRestoredGroup(groups, record, restoredModel));
  setRecords(records.filter((existing) => existing !== record));
}

function indexRecombinableRecordsByFirstSplitGroupId(
  groups: ReadonlyArray<ReviewGroupViewModel>,
  records: ReadonlyArray<SplitGroupRecoveryRecord>,
): ReadonlyMap<string, SplitGroupRecoveryRecord> {
  const byFirstSplitGroupId = new Map<string, SplitGroupRecoveryRecord>();
  for (const record of records) {
    const firstSplitGroupId = record.splitGroupIds[0];
    if (firstSplitGroupId === undefined) continue;
    if (!canRecombineSplitGroupsIntoOriginal(groups, record)) continue;
    byFirstSplitGroupId.set(firstSplitGroupId, record);
  }
  return byFirstSplitGroupId;
}

function appendEmptyStackGroup(
  groups: ReadonlyArray<ReviewGroupViewModel>,
): ReadonlyArray<ReviewGroupViewModel> {
  return [
    ...groups,
    {
      id: `image-${groups.length + 1}-${Date.now()}`,
      mode: "stack",
      rows: [],
      sortBy: "custom",
      hadConfidentWavelengthParse: false,
    },
  ];
}

function OpenImagesReviewHeader(): JSX.Element {
  return (
    <DialogHeader>
      <DialogTitle>Review stacks</DialogTitle>
      <DialogDescription>
        Drag rows to reorder within a stack, or between stacks.
      </DialogDescription>
    </DialogHeader>
  );
}

interface DragBetweenGroupsHandlers {
  readonly onRowDragStart: (groupId: string, rowIndex: number) => void;
  readonly onRowDropAtRow: (targetGroupId: string, targetRowIndex: number) => void;
  readonly onRowDropAtEnd: (targetGroupId: string) => void;
}

interface DragSourceRefValue {
  readonly groupId: string;
  readonly rowIndex: number;
  readonly isMultiBandRaster: boolean;
}

function useDragBetweenGroupsHandlers(
  groups: ReadonlyArray<ReviewGroupViewModel>,
  setGroups: (next: ReadonlyArray<ReviewGroupViewModel>) => void,
): DragBetweenGroupsHandlers {
  const dragSourceRef = useRef<DragSourceRefValue | null>(null);
  const onRowDragStart = useCallback(
    (groupId: string, rowIndex: number) => {
      dragSourceRef.current = buildDragSourceForGroupAndRow(groups, groupId, rowIndex);
    },
    [groups],
  );
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

function buildDragSourceForGroupAndRow(
  groups: ReadonlyArray<ReviewGroupViewModel>,
  groupId: string,
  rowIndex: number,
): DragSourceRefValue {
  const sourceGroup = groups.find((group) => group.id === groupId);
  const sourceRow = sourceGroup?.rows[rowIndex];
  return { groupId, rowIndex, isMultiBandRaster: sourceRow ? isMultiBandRasterRow(sourceRow) : false };
}

// CT-263: only an already-multi-band SCIENTIFIC raster refuses the cross-group
// drag outright; a colour photo may land in a stack group, where its row badge
// explains it opens on its own and blocks the combine.
function isMultiBandRasterRow(row: GroupedOpenedFileRow): boolean {
  if (row.source === null) return false;
  if (row.source.kind !== "raster") return false;
  return classifyOpenedRasterByShape(row.source.raster).kind === "already-multi-band";
}

function rejectMultiBandDragIntoDifferentGroupOrPass(
  source: DragSourceRefValue,
  targetGroupId: string,
): boolean {
  const isCrossGroupMove = source.groupId !== targetGroupId;
  if (!source.isMultiBandRaster || !isCrossGroupMove) return true;
  notifyError("Multi-band stack must open as its own stack; it cannot be combined with other bands.");
  return false;
}

function runDropAtRowWithDragRef(
  dragSourceRef: React.MutableRefObject<DragSourceRefValue | null>,
  targetGroupId: string,
  targetRowIndex: number,
  groups: ReadonlyArray<ReviewGroupViewModel>,
  setGroups: (next: ReadonlyArray<ReviewGroupViewModel>) => void,
): void {
  const source = dragSourceRef.current;
  if (!source) return;
  dragSourceRef.current = null;
  if (!rejectMultiBandDragIntoDifferentGroupOrPass(source, targetGroupId)) return;
  setGroups(moveRowAcrossGroups(groups, source, { groupId: targetGroupId, rowIndex: targetRowIndex }));
}

function runDropAtEndWithDragRef(
  dragSourceRef: React.MutableRefObject<DragSourceRefValue | null>,
  targetGroupId: string,
  groups: ReadonlyArray<ReviewGroupViewModel>,
  setGroups: (next: ReadonlyArray<ReviewGroupViewModel>) => void,
): void {
  const source = dragSourceRef.current;
  if (!source) return;
  dragSourceRef.current = null;
  if (!rejectMultiBandDragIntoDifferentGroupOrPass(source, targetGroupId)) return;
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
  return insertRowIntoGroupAtIndex(stripped, movingRow, target.rowIndex);
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
): ReviewGroupViewModel {
  const clampedIndex = Math.max(0, Math.min(rowIndex, group.rows.length));
  const inserted = [
    ...group.rows.slice(0, clampedIndex),
    row,
    ...group.rows.slice(clampedIndex),
  ];
  return {
    ...group,
    mode: pickGroupModeAfterRowInsert(group.mode, inserted.length),
    rows: inserted,
    sortBy: "custom",
  };
}

// CT-252: singles groups hold exactly one row; dragging rows together always
// combines them into a stack group (recombine by dragging, per the split model).
function pickGroupModeAfterRowInsert(
  mode: OpenedFilesGroupMode,
  insertedRowCount: number,
): OpenedFilesGroupMode {
  return insertedRowCount >= 2 ? "stack" : mode;
}

interface OpenImagesReviewGroupListProps {
  readonly groups: ReadonlyArray<ReviewGroupViewModel>;
  readonly setGroups: (next: ReadonlyArray<ReviewGroupViewModel>) => void;
  readonly splitRecovery: SplitRecoveryApi;
  readonly dragHandlers: DragBetweenGroupsHandlers;
}

function OpenImagesReviewGroupList(props: OpenImagesReviewGroupListProps): JSX.Element {
  return (
    <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
      {props.groups.map((group, index) => (
        <OpenImagesReviewGroupListEntry
          key={group.id}
          group={group}
          groupIndex={index}
          listProps={props}
        />
      ))}
    </div>
  );
}

interface OpenImagesReviewGroupListEntryProps {
  readonly group: ReviewGroupViewModel;
  readonly groupIndex: number;
  readonly listProps: OpenImagesReviewGroupListProps;
}

function OpenImagesReviewGroupListEntry(props: OpenImagesReviewGroupListEntryProps): JSX.Element {
  const { group, groupIndex, listProps } = props;
  const { groups, setGroups, splitRecovery, dragHandlers } = listProps;
  return (
    <>
      <RecombineSplitGroupsAffordanceWhenLeading group={group} splitRecovery={splitRecovery} />
      <OpenImagesReviewGroupCard
        group={group}
        groupIndex={groupIndex}
        onUpdateGroup={(next) => setGroups(replaceGroupById(groups, group.id, next))}
        onRemoveGroup={() => setGroups(removeGroupById(groups, group.id))}
        onSplitGroupIntoSingleImages={() => splitRecovery.splitGroupRecordingRecovery(group)}
        dragHandlers={dragHandlers}
      />
    </>
  );
}

// CT-264: the recombine affordance renders directly above the FIRST group
// produced by a split, covering the run of single-image groups beneath it.
function RecombineSplitGroupsAffordanceWhenLeading(props: {
  readonly group: ReviewGroupViewModel;
  readonly splitRecovery: SplitRecoveryApi;
}): JSX.Element | null {
  const record = props.splitRecovery.recombinableRecordByFirstSplitGroupId.get(props.group.id);
  if (record === undefined) return null;
  return (
    <RecombineSplitGroupsButton
      onRecombine={() => props.splitRecovery.recombineSplitGroups(record)}
    />
  );
}

function RecombineSplitGroupsButton(props: { readonly onRecombine: () => void }): JSX.Element {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="self-start"
      onClick={props.onRecombine}
    >
      <Undo2 className="mr-2 size-4" /> Recombine into one stack
    </Button>
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
  readonly groupIndex: number;
  readonly onUpdateGroup: (next: ReviewGroupViewModel) => void;
  readonly onRemoveGroup: () => void;
  readonly onSplitGroupIntoSingleImages: () => void;
  readonly dragHandlers: DragBetweenGroupsHandlers;
}

function OpenImagesReviewGroupCard(props: OpenImagesReviewGroupCardProps): JSX.Element {
  const validation = useMemo(
    () => buildValidationStatesForGroup(props.group),
    [props.group],
  );
  return (
    <section
      aria-label={describeGroupAriaLabel(props.group, props.groupIndex)}
      className="rounded-md border bg-card p-2"
      onDragOver={(event) => event.preventDefault()}
      onDrop={() => props.dragHandlers.onRowDropAtEnd(props.group.id)}
    >
      <OpenImagesReviewGroupCardHeader
        group={props.group}
        groupIndex={props.groupIndex}
        onUpdateGroup={props.onUpdateGroup}
        onRemoveGroup={props.onRemoveGroup}
        onSplitGroupIntoSingleImages={props.onSplitGroupIntoSingleImages}
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

function describeGroupAriaLabel(group: ReviewGroupViewModel, groupIndex: number): string {
  const positionLabel = `Stack ${groupIndex + 1}`;
  if (group.mode === "stack") {
    return `Multi-band ${positionLabel} (${group.rows.length} rows)`;
  }
  return `${positionLabel} - bands open separately (${group.rows.length} rows)`;
}

interface GroupValidationSummary {
  readonly perRow: ReadonlyArray<RowValidationState>;
  readonly canStack: boolean;
  readonly disabledStackReason: string | null;
}

type RowValidationState =
  | { readonly kind: "valid" }
  | { readonly kind: "decode-failed"; readonly message: string }
  | { readonly kind: "color-photo" }
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

// CT-263: validation keys on the decoded raster's shape via the shared
// classifier, so a single-band image of ANY source kind is stackable and a
// colour photo is called out as a photo (never as a "(1 bands)" raster).
function deriveRowValidationState(
  row: GroupedOpenedFileRow,
  baseline: RasterImage | null,
): RowValidationState {
  if (row.decodeError !== null) return { kind: "decode-failed", message: row.decodeError };
  if (row.source === null) return { kind: "decode-failed", message: "Failed to decode" };
  if (row.source.kind !== "raster") return { kind: "color-photo" };
  const classification = classifyOpenedRasterByShape(row.source.raster);
  if (classification.kind !== "stackable-plane") return classification;
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
  if (rows.length < 2) return "Need at least 2 rows to combine bands";
  if (perRow.some((state) => state.kind === "decode-failed")) return "One or more rows failed to decode";
  if (perRow.some((state) => state.kind === "color-photo")) return "Color photos open on their own; they cannot be combined";
  if (perRow.some((state) => state.kind === "already-multi-band")) return "Already multi-band rasters cannot be combined";
  if (perRow.some((state) => state.kind === "property-mismatch")) return "Row dimensions or formats do not match";
  return "Cannot combine bands";
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
  readonly groupIndex: number;
  readonly onUpdateGroup: (next: ReviewGroupViewModel) => void;
  readonly onRemoveGroup: () => void;
  readonly onSplitGroupIntoSingleImages: () => void;
  readonly canSwitchModes: boolean;
}

function OpenImagesReviewGroupCardHeader(
  props: OpenImagesReviewGroupCardHeaderProps,
): JSX.Element {
  const title = pickGroupTitle(props.group, props.groupIndex);
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="flex-1 truncate text-sm font-medium">{title}</span>
      {shouldShowGroupModeDropdown(props.group) ? (
        <GroupModeDropdown
          group={props.group}
          onUpdateGroup={props.onUpdateGroup}
          onSplitGroupIntoSingleImages={props.onSplitGroupIntoSingleImages}
          canSwitchToStack={props.canSwitchModes}
        />
      ) : null}
      <RemoveGroupButton onRemoveGroup={props.onRemoveGroup} />
    </div>
  );
}

function shouldShowGroupModeDropdown(group: ReviewGroupViewModel): boolean {
  return group.rows.length >= 2;
}

function pickGroupTitle(group: ReviewGroupViewModel, groupIndex: number): string {
  if (group.rows.length === 0) return "Empty stack";
  if (group.mode === "singles" && group.rows.length === 1) {
    return group.rows[0]!.fileName;
  }
  return `Stack ${groupIndex + 1}`;
}

interface GroupModeDropdownProps {
  readonly group: ReviewGroupViewModel;
  readonly onUpdateGroup: (next: ReviewGroupViewModel) => void;
  readonly onSplitGroupIntoSingleImages: () => void;
  readonly canSwitchToStack: boolean;
}

function GroupModeDropdown(props: GroupModeDropdownProps): JSX.Element {
  const tooltip = props.canSwitchToStack ? null : "Bands cannot be combined";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <GroupModeNativeSelect
            group={props.group}
            onUpdateGroup={props.onUpdateGroup}
            onSplitGroupIntoSingleImages={props.onSplitGroupIntoSingleImages}
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
      onChange={(event) => applyGroupModeChoice(event.target.value as OpenedFilesGroupMode, props)}
      className="h-8 w-44 rounded-md border bg-card px-2 text-xs text-foreground"
    >
      <option value="stack" disabled={!props.canSwitchToStack}>
        Combine into one stack
      </option>
      <option value="singles">Open bands separately</option>
    </select>
  );
}

// CT-252: choosing "Open bands separately" physically splits the group into one
// single-image group per row; it is no longer a mode a multi-row group can hold.
function applyGroupModeChoice(mode: OpenedFilesGroupMode, props: GroupModeDropdownProps): void {
  if (mode === "singles") {
    props.onSplitGroupIntoSingleImages();
    return;
  }
  props.onUpdateGroup({ ...props.group, mode });
}

function RemoveGroupButton({ onRemoveGroup }: { onRemoveGroup: () => void }): JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Remove stack"
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
  const effectiveState = filterValidationStateForGroupMode(props.validationState, props.group.mode);
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
      <RowMainContent row={props.row} validationState={effectiveState} />
    </li>
  );
}

function filterValidationStateForGroupMode(
  state: RowValidationState,
  mode: OpenedFilesGroup["mode"],
): RowValidationState {
  if (mode !== "singles") return state;
  if (state.kind === "already-multi-band") return { kind: "valid" };
  if (state.kind === "color-photo") return { kind: "valid" };
  if (state.kind === "property-mismatch") return { kind: "valid" };
  return state;
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
      <span>{formatFileSizeBytesForDisplay(totalRowSizeIncludingSidecar(row))}</span>
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

function totalRowSizeIncludingSidecar(row: GroupedOpenedFileRow): number {
  return row.fileSizeBytes + (row.sidecarSizeBytes ?? 0);
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
  if (state.kind === "color-photo") return "Color photo; opens on its own";
  if (state.kind === "already-multi-band") {
    return `Multi-band raster (${state.bandCount} bands); will open as its own stack`;
  }
  return state.message;
}

interface AddNewImageButtonProps {
  readonly onAdd: () => void;
}

function AddNewImageButton(props: AddNewImageButtonProps): JSX.Element {
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
    if (!isSingleRowGroupOrCanStack(group)) return false;
  }
  return groups.length > 0;
}

function isSingleRowGroupOrCanStack(group: ReviewGroupViewModel): boolean {
  if (group.rows.length < 2) return true;
  if (group.mode !== "stack") return true;
  return buildValidationStatesForGroup(group).canStack;
}

function buildConfirmButtonLabelForGroups(
  groups: ReadonlyArray<ReviewGroupViewModel>,
): string {
  const imageCount = countResultingImagesAcrossGroups(groups);
  if (imageCount === 0) return "Open";
  return `Open ${imageCount} ${imageCount === 1 ? "stack" : "stacks"}`;
}

function countResultingImagesAcrossGroups(
  groups: ReadonlyArray<ReviewGroupViewModel>,
): number {
  return groups.reduce((sum, group) => sum + countResultingImagesForGroup(group), 0);
}

function countResultingImagesForGroup(group: ReviewGroupViewModel): number {
  if (group.rows.length === 0) return 0;
  if (group.mode === "stack") return 1;
  return group.rows.length;
}
