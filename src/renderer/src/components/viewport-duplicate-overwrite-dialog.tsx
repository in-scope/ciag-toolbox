import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ViewportCellContent } from "@/components/viewport-grid";
import { getViewportNumberFromIndex } from "@/lib/grid/grid-layout";

export interface PendingDuplicateOverwrite {
  sourceIndex: number;
  targetIndex: number;
  sourceContent: ViewportCellContent;
  targetFileName: string;
}

interface DuplicateOverwriteDialogProps {
  pending: PendingDuplicateOverwrite | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DuplicateOverwriteAlertDialog(props: DuplicateOverwriteDialogProps): JSX.Element {
  return (
    <AlertDialog
      open={props.pending !== null}
      onOpenChange={(open) => closeDialogIfRequested(open, props.onCancel)}
    >
      <AlertDialogContent>
        <DuplicateOverwriteDialogBody pending={props.pending} />
        <DuplicateOverwriteDialogActions onCancel={props.onCancel} onConfirm={props.onConfirm} />
      </AlertDialogContent>
    </AlertDialog>
  );
}

function closeDialogIfRequested(open: boolean, onCancel: () => void): void {
  if (!open) onCancel();
}

function DuplicateOverwriteDialogBody({
  pending,
}: {
  pending: PendingDuplicateOverwrite | null;
}): JSX.Element {
  const targetNumber = pending ? getViewportNumberFromIndex(pending.targetIndex) : 0;
  return (
    <AlertDialogHeader>
      <AlertDialogTitle>Replace viewport {targetNumber}?</AlertDialogTitle>
      <AlertDialogDescription>
        {describeOverwriteMessage(pending)}
      </AlertDialogDescription>
    </AlertDialogHeader>
  );
}

function describeOverwriteMessage(pending: PendingDuplicateOverwrite | null): string {
  if (!pending) return "";
  const targetNumber = getViewportNumberFromIndex(pending.targetIndex);
  return `Viewport ${targetNumber} already contains "${pending.targetFileName}". Replace it with "${pending.sourceContent.fileName}"?`;
}

function DuplicateOverwriteDialogActions({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  return (
    <AlertDialogFooter>
      <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={onConfirm}>Replace</AlertDialogAction>
    </AlertDialogFooter>
  );
}
