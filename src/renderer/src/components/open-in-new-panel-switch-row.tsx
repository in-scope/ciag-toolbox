import { Switch } from "@/components/ui/switch";

// CT-277: the off state is named beneath the switch in every panel that
// renders the toggle, so nobody has to guess what turning it off means.
export const OPEN_IN_NEW_PANEL_OFF_STATE_HINT = "Off: replaces the current panel.";

export interface OpenInNewPanelSwitchRowProps {
  readonly switchId: string;
  readonly checked: boolean;
  readonly onCheckedChange: (next: boolean) => void;
}

export function OpenInNewPanelSwitchRow(props: OpenInNewPanelSwitchRowProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={props.switchId}
        className="flex cursor-pointer items-center justify-between gap-3 text-sm"
      >
        <span>Open in a new panel</span>
        <Switch
          id={props.switchId}
          checked={props.checked}
          onCheckedChange={props.onCheckedChange}
        />
      </label>
      <p className="text-xs text-muted-foreground">{OPEN_IN_NEW_PANEL_OFF_STATE_HINT}</p>
    </div>
  );
}
