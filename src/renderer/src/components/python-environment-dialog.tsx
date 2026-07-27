import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  describePythonEnvironmentStatus,
  normalizeOwnInterpreterPathInput,
  type PythonEnvironmentSnapshot,
} from "@/lib/python/own-environment-preference";

const BUNDLED_SNAPSHOT: PythonEnvironmentSnapshot = {
  ownInterpreterPath: null,
  pathExists: false,
};

function usePythonEnvironmentMenuOpensDialog(setOpen: (open: boolean) => void): void {
  useEffect(
    () => window.toolboxApi.onMenuPythonEnvironment(() => setOpen(true)),
    [setOpen],
  );
}

function useLoadPythonEnvironmentWhenDialogOpens(
  open: boolean,
  applySnapshot: (snapshot: PythonEnvironmentSnapshot) => void,
): void {
  useEffect(() => {
    if (!open) return;
    void window.toolboxApi.getPythonEnvironment().then(applySnapshot);
  }, [open, applySnapshot]);
}

export function PythonEnvironmentDialog(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<PythonEnvironmentSnapshot>(BUNDLED_SNAPSHOT);
  const [draftPath, setDraftPath] = useState("");
  usePythonEnvironmentMenuOpensDialog(setOpen);
  const applySnapshot = useApplyPythonEnvironmentSnapshot(setSnapshot, setDraftPath);
  useLoadPythonEnvironmentWhenDialogOpens(open, applySnapshot);
  const saveOwnPath = useCallback(
    () => void configurePythonInterpreter(draftPath, applySnapshot),
    [draftPath, applySnapshot],
  );
  const useBundledRuntime = useCallback(
    () => void configurePythonInterpreter("", applySnapshot),
    [applySnapshot],
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <PythonEnvironmentDialogHeader />
        <PythonEnvironmentPathField draftPath={draftPath} onDraftChange={setDraftPath} />
        <PythonEnvironmentStatusNotice snapshot={snapshot} />
        <PythonEnvironmentDialogFooter
          onSave={saveOwnPath}
          onUseBundledRuntime={useBundledRuntime}
        />
      </DialogContent>
    </Dialog>
  );
}

function useApplyPythonEnvironmentSnapshot(
  setSnapshot: (snapshot: PythonEnvironmentSnapshot) => void,
  setDraftPath: (path: string) => void,
): (snapshot: PythonEnvironmentSnapshot) => void {
  return useCallback(
    (snapshot: PythonEnvironmentSnapshot) => {
      setSnapshot(snapshot);
      setDraftPath(snapshot.ownInterpreterPath ?? "");
    },
    [setSnapshot, setDraftPath],
  );
}

async function configurePythonInterpreter(
  rawPath: string,
  applySnapshot: (snapshot: PythonEnvironmentSnapshot) => void,
): Promise<void> {
  const nextPath = normalizeOwnInterpreterPathInput(rawPath);
  const snapshot = await window.toolboxApi.setPythonEnvironment(nextPath);
  applySnapshot(snapshot);
}

function PythonEnvironmentDialogHeader(): JSX.Element {
  return (
    <DialogHeader>
      <DialogTitle>Python environment</DialogTitle>
      <DialogDescription>
        Point the toolbox at your own Python interpreter or virtual environment to run
        scripts with your own third-party packages. Leave this empty to use the bundled
        runtime. The app never installs packages.
      </DialogDescription>
    </DialogHeader>
  );
}

interface PythonEnvironmentPathFieldProps {
  draftPath: string;
  onDraftChange: (path: string) => void;
}

function PythonEnvironmentPathField({
  draftPath,
  onDraftChange,
}: PythonEnvironmentPathFieldProps): JSX.Element {
  return (
    <div className="space-y-2">
      <span className="text-sm font-medium">Own Python interpreter</span>
      <Input
        aria-label="Own Python interpreter path"
        placeholder="e.g. C:\\my-venv\\Scripts\\python.exe"
        value={draftPath}
        onChange={(event) => onDraftChange(event.target.value)}
      />
    </div>
  );
}

function PythonEnvironmentStatusNotice({
  snapshot,
}: {
  snapshot: PythonEnvironmentSnapshot;
}): JSX.Element {
  const status = describePythonEnvironmentStatus(snapshot);
  if (status.mode === "bundled") return <BundledModeNotice />;
  if (status.mode === "own-missing") return <OwnEnvironmentMissingNotice />;
  return <OwnEnvironmentTrustedNotice />;
}

function BundledModeNotice(): JSX.Element {
  return (
    <p className="rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground">
      Using the bundled runtime (numpy, scipy, scikit-image). Scripts run sandboxed.
    </p>
  );
}

function OwnEnvironmentTrustedNotice(): JSX.Element {
  return (
    <p className="rounded-md border border-border bg-muted p-3 text-sm">
      <span className="font-medium text-destructive">Trusted (unsandboxed) mode.</span>{" "}
      <span className="text-muted-foreground">
        Scripts run with full access to your interpreter and system. Only the wall-clock
        and memory limits still apply.
      </span>
    </p>
  );
}

function OwnEnvironmentMissingNotice(): JSX.Element {
  return (
    <p className="rounded-md border border-destructive bg-muted p-3 text-sm text-destructive">
      This interpreter path does not exist. Fix the path, or clear it to use the bundled
      runtime.
    </p>
  );
}

interface PythonEnvironmentDialogFooterProps {
  onSave: () => void;
  onUseBundledRuntime: () => void;
}

function PythonEnvironmentDialogFooter({
  onSave,
  onUseBundledRuntime,
}: PythonEnvironmentDialogFooterProps): JSX.Element {
  return (
    <DialogFooter>
      <Button variant="outline" onClick={onUseBundledRuntime}>
        Use bundled runtime
      </Button>
      <Button onClick={onSave}>Save</Button>
    </DialogFooter>
  );
}
