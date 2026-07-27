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
import { buttonVariants } from "@/components/ui/button";

// CT-258: shown when the window close was requested while unsaved work exists.
// Esc and the Cancel button dismiss the dialog and the app stays open; the two
// action buttons resolve the pending close through the guard hook.

export interface SaveBeforeCloseDialogProps {
  open: boolean;
  onSaveAndClose: () => void;
  onCloseWithoutSaving: () => void;
  onCancel: () => void;
}

export function SaveBeforeCloseDialog(props: SaveBeforeCloseDialogProps): JSX.Element {
  return (
    <AlertDialog open={props.open} onOpenChange={(open) => dismissWhenClosed(open, props)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Save this project before closing?</AlertDialogTitle>
          <AlertDialogDescription>Unsaved changes will be lost.</AlertDialogDescription>
        </AlertDialogHeader>
        <SaveBeforeCloseDialogFooter {...props} />
      </AlertDialogContent>
    </AlertDialog>
  );
}

function dismissWhenClosed(open: boolean, props: SaveBeforeCloseDialogProps): void {
  if (!open) props.onCancel();
}

function SaveBeforeCloseDialogFooter(props: SaveBeforeCloseDialogProps): JSX.Element {
  return (
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction
        className={buttonVariants({ variant: "destructive" })}
        onClick={props.onCloseWithoutSaving}
      >
        Close without saving
      </AlertDialogAction>
      <AlertDialogAction onClick={props.onSaveAndClose}>Save and close</AlertDialogAction>
    </AlertDialogFooter>
  );
}
