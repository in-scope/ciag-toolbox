import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AppInfoState {
  name: string;
  version: string;
}

const EMPTY_APP_INFO: AppInfoState = { name: "", version: "" };

function useAppInfoFromMainProcess(): AppInfoState {
  const [appInfo, setAppInfo] = useState<AppInfoState>(EMPTY_APP_INFO);
  useEffect(() => {
    void window.toolboxApi.getAppInfo().then(setAppInfo);
  }, []);
  return appInfo;
}

function useAboutMenuOpensDialog(
  setOpen: (open: boolean) => void,
): void {
  useEffect(() => window.toolboxApi.onMenuAbout(() => setOpen(true)), [setOpen]);
}

export function AboutDialog(): JSX.Element {
  const [open, setOpen] = useState(false);
  const appInfo = useAppInfoFromMainProcess();
  useAboutMenuOpensDialog(setOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>About {appInfo.name}</DialogTitle>
          <DialogDescription>Version {appInfo.version}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          A cross-platform desktop application for multispectral image
          analysis.
        </p>
      </DialogContent>
    </Dialog>
  );
}
