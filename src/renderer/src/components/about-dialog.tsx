import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  THIRD_PARTY_ACKNOWLEDGEMENTS,
  type ThirdPartyAcknowledgement,
} from "@/lib/licensing/third-party-acknowledgements";

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
        <ThirdPartyAcknowledgementsSection />
      </DialogContent>
    </Dialog>
  );
}

function ThirdPartyAcknowledgementsSection(): JSX.Element {
  return (
    <section className="mt-2">
      <h3 className="text-sm font-medium">Third-party acknowledgements</h3>
      <ul className="mt-2 max-h-48 space-y-3 overflow-y-auto pr-1">
        {THIRD_PARTY_ACKNOWLEDGEMENTS.map(renderAcknowledgementListItem)}
      </ul>
    </section>
  );
}

function renderAcknowledgementListItem(
  entry: ThirdPartyAcknowledgement,
): JSX.Element {
  return (
    <li key={entry.name} className="text-xs text-muted-foreground">
      <details>
        <summary className="cursor-pointer text-foreground">
          {entry.name} <span className="text-muted-foreground">({entry.license})</span>
        </summary>
        <p className="mt-1">{entry.purpose}</p>
        <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-snug">
          {entry.licenseText}
        </pre>
      </details>
    </li>
  );
}
