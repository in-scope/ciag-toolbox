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

export interface DivergedSourceListItem {
  readonly index: number;
  readonly fileName: string;
}

export interface PendingDivergenceConfirmation {
  readonly diverged: ReadonlyArray<DivergedSourceListItem>;
}

interface DivergedSourceWarningDialogProps {
  pending: PendingDivergenceConfirmation | null;
  onContinue: () => void;
  onCancel: () => void;
}

export function DivergedSourceWarningDialog(
  props: DivergedSourceWarningDialogProps,
): JSX.Element {
  return (
    <AlertDialog open={props.pending !== null}>
      <AlertDialogContent>
        {props.pending ? renderDivergenceContent(props.pending, props) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function renderDivergenceContent(
  pending: PendingDivergenceConfirmation,
  props: DivergedSourceWarningDialogProps,
): JSX.Element {
  return (
    <>
      <DivergenceWarningHeader />
      <DivergedSourceList items={pending.diverged} />
      <DivergenceWarningFooter onContinue={props.onContinue} onCancel={props.onCancel} />
    </>
  );
}

function DivergenceWarningHeader(): JSX.Element {
  return (
    <AlertDialogHeader>
      <AlertDialogTitle>Source files have changed</AlertDialogTitle>
      <AlertDialogDescription>
        Some referenced files have changed since this project was saved.
        You can continue with the current file content, or cancel.
      </AlertDialogDescription>
    </AlertDialogHeader>
  );
}

function DivergedSourceList({
  items,
}: {
  items: ReadonlyArray<DivergedSourceListItem>;
}): JSX.Element {
  return (
    <ul className="max-h-48 overflow-y-auto rounded-md border bg-card px-3 py-2 text-sm">
      {items.map((item) => (
        <li key={item.index} className="truncate font-mono">
          {`Viewport ${item.index + 1} (${item.fileName})`}
        </li>
      ))}
    </ul>
  );
}

function DivergenceWarningFooter({
  onContinue,
  onCancel,
}: {
  onContinue: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <AlertDialogFooter>
      <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={onContinue}>Continue with current files</AlertDialogAction>
    </AlertDialogFooter>
  );
}
