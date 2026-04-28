import { useState, type FormEvent, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  computeInitialPickerTargetsFromSelection,
  makeAllViewportsPickerTargets,
  togglePickerTargetAtIndex,
} from "@/lib/actions/picker-targets";
import type { RegisteredViewportAction } from "@/lib/actions/registered-actions";
import { getViewportNumberFromIndex } from "@/lib/grid/grid-layout";

export interface OperationTargetPickerViewportEntry {
  readonly index: number;
  readonly fileName: string | null;
}

interface OperationTargetPickerProps {
  open: boolean;
  action: RegisteredViewportAction | null;
  cellCount: number;
  viewports: ReadonlyArray<OperationTargetPickerViewportEntry>;
  initiallySelectedIndices: ReadonlySet<number>;
  onCancel: () => void;
  onConfirm: (targetIndices: ReadonlySet<number>) => void;
}

export function OperationTargetPicker(props: OperationTargetPickerProps): JSX.Element {
  return (
    <Dialog open={props.open} onOpenChange={(open) => closePickerWhenDismissed(open, props.onCancel)}>
      <DialogContent>
        {props.open && props.action ? renderPickerForm(props, props.action) : null}
      </DialogContent>
    </Dialog>
  );
}

function closePickerWhenDismissed(open: boolean, onCancel: () => void): void {
  if (!open) onCancel();
}

function renderPickerForm(
  props: OperationTargetPickerProps,
  action: RegisteredViewportAction,
): JSX.Element {
  return (
    <OperationTargetPickerForm
      action={action}
      cellCount={props.cellCount}
      viewports={props.viewports}
      initiallySelectedIndices={props.initiallySelectedIndices}
      onCancel={props.onCancel}
      onConfirm={props.onConfirm}
    />
  );
}

interface OperationTargetPickerFormProps {
  action: RegisteredViewportAction;
  cellCount: number;
  viewports: ReadonlyArray<OperationTargetPickerViewportEntry>;
  initiallySelectedIndices: ReadonlySet<number>;
  onCancel: () => void;
  onConfirm: (targetIndices: ReadonlySet<number>) => void;
}

function OperationTargetPickerForm(props: OperationTargetPickerFormProps): JSX.Element {
  const [targets, setTargets] = useState<ReadonlySet<number>>(() =>
    computeInitialPickerTargetsFromSelection(props.initiallySelectedIndices, props.cellCount),
  );
  const handleSubmit = (event: FormEvent<HTMLFormElement>) =>
    submitPickerForm(event, targets, props.onConfirm);
  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>) =>
    submitOnEnterKeyWhenAnyTargetChecked(event, targets, props.onConfirm);
  return (
    <form className="contents" onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
      <PickerHeader actionLabel={props.action.label} />
      <PickerSelectAllRow cellCount={props.cellCount} onSelectAll={() => setTargets(makeAllViewportsPickerTargets(props.cellCount))} />
      <PickerViewportList viewports={props.viewports} targets={targets} onToggleTarget={(index) => setTargets(togglePickerTargetAtIndex(targets, index))} />
      <PickerFooter checkedCount={targets.size} onCancel={props.onCancel} />
    </form>
  );
}

function submitPickerForm(
  event: FormEvent<HTMLFormElement>,
  targets: ReadonlySet<number>,
  onConfirm: (targets: ReadonlySet<number>) => void,
): void {
  event.preventDefault();
  if (targets.size === 0) return;
  onConfirm(targets);
}

function submitOnEnterKeyWhenAnyTargetChecked(
  event: KeyboardEvent<HTMLFormElement>,
  targets: ReadonlySet<number>,
  onConfirm: (targets: ReadonlySet<number>) => void,
): void {
  if (event.key !== "Enter" || event.defaultPrevented) return;
  if (targets.size === 0) return;
  event.preventDefault();
  onConfirm(targets);
}

function PickerHeader({ actionLabel }: { actionLabel: string }): JSX.Element {
  return (
    <DialogHeader>
      <DialogTitle>{actionLabel}</DialogTitle>
      <DialogDescription>Choose the viewports to apply this action to.</DialogDescription>
    </DialogHeader>
  );
}

function PickerSelectAllRow({
  cellCount,
  onSelectAll,
}: {
  cellCount: number;
  onSelectAll: () => void;
}): JSX.Element {
  return (
    <div className="flex justify-end">
      <Button type="button" variant="ghost" size="sm" onClick={onSelectAll} disabled={cellCount === 0}>
        Apply to all
      </Button>
    </div>
  );
}

interface PickerViewportListProps {
  viewports: ReadonlyArray<OperationTargetPickerViewportEntry>;
  targets: ReadonlySet<number>;
  onToggleTarget: (index: number) => void;
}

function PickerViewportList(props: PickerViewportListProps): JSX.Element {
  return (
    <div role="group" aria-label="Target viewports" className="flex max-h-72 flex-col gap-1 overflow-y-auto pr-1">
      {props.viewports.map((viewport) => (
        <PickerViewportRow
          key={viewport.index}
          viewport={viewport}
          isChecked={props.targets.has(viewport.index)}
          onToggle={() => props.onToggleTarget(viewport.index)}
        />
      ))}
    </div>
  );
}

interface PickerViewportRowProps {
  viewport: OperationTargetPickerViewportEntry;
  isChecked: boolean;
  onToggle: () => void;
}

function PickerViewportRow(props: PickerViewportRowProps): JSX.Element {
  const label = describePickerViewportRowLabel(props.viewport);
  const checkboxId = `picker-viewport-${props.viewport.index}`;
  return (
    <label htmlFor={checkboxId} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
      <Checkbox id={checkboxId} checked={props.isChecked} onCheckedChange={props.onToggle} aria-label={label} />
      <span className="truncate" title={label}>{label}</span>
    </label>
  );
}

function describePickerViewportRowLabel(viewport: OperationTargetPickerViewportEntry): string {
  const number = getViewportNumberFromIndex(viewport.index);
  if (viewport.fileName) return `Viewport ${number} (${viewport.fileName})`;
  return `Viewport ${number} (empty)`;
}

function PickerFooter({
  checkedCount,
  onCancel,
}: {
  checkedCount: number;
  onCancel: () => void;
}): JSX.Element {
  return (
    <DialogFooter>
      <Button type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={checkedCount === 0}>
        Apply
      </Button>
    </DialogFooter>
  );
}
