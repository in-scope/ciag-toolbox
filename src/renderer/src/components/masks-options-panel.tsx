import { X } from "lucide-react";

import { MaskBrushControls } from "@/components/mask-brush-controls";
import { MaskFileTransferButtons } from "@/components/mask-file-transfer-buttons";
import { MaskLayerEditor } from "@/components/mask-layer-editor";
import { MaskThresholdPromotionControl } from "@/components/mask-threshold-promotion-control";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { buildLoadedPanelReferenceToken, type LoadedReferenceCandidate } from "@/lib/image/reference-token";
import {
  addNewMaskLayerToPanel,
  deleteMaskLayerFromPanel,
  findSelectedMaskLayerOrNull,
  panelHasMaskLayers,
  replaceMaskLayerInPanel,
  selectMaskLayerInPanel,
  type MaskPanelState,
} from "@/lib/masks/mask-panel";
import type { MaskBrushSettings } from "@/lib/masks/mask-brush";
import type { MaskLayer } from "@/lib/masks/mask-layer";

// CT-302: the Masks tool's aside. It lists the ACTIVE panel's mask layers with
// New / Rename / Delete, keeps exactly one of them selected (only the selected
// layer renders as an overlay), and edits that layer's categories and opacity.
// CT-303 added the Import/Export row (components/mask-file-transfer-buttons.tsx)
// and CT-304 the brush controls (components/mask-brush-controls.tsx).

export interface MasksOptionsTarget {
  readonly viewportNumber: number;
  readonly fileName: string;
  readonly width: number;
  readonly height: number;
  readonly masks: MaskPanelState;
}

export interface MasksOptionsPanelProps {
  readonly target: MasksOptionsTarget | null;
  readonly onChangeMasks: (next: MaskPanelState) => void;
  readonly brush: MaskBrushSettings;
  readonly onChangeBrush: (next: MaskBrushSettings) => void;
  readonly loadedReferenceCandidates: ReadonlyArray<LoadedReferenceCandidate>;
  readonly onClose: () => void;
}

export function MasksOptionsPanel(props: MasksOptionsPanelProps): JSX.Element {
  return (
    <aside aria-label="Masks options" className={MASKS_PANEL_CLASSES}>
      <MasksOptionsHeader
        viewportNumber={props.target?.viewportNumber ?? null}
        onClose={props.onClose}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {props.target ? (
          <MasksOptionsBody
            target={props.target}
            onChangeMasks={props.onChangeMasks}
            brush={props.brush}
            onChangeBrush={props.onChangeBrush}
            loadedReferenceCandidates={props.loadedReferenceCandidates}
          />
        ) : (
          <p className="text-xs text-muted-foreground">{NO_ACTIVE_PANEL_HINT}</p>
        )}
      </div>
    </aside>
  );
}

const MASKS_PANEL_CLASSES = "flex w-[300px] shrink-0 flex-col border-l bg-card";
const NO_ACTIVE_PANEL_HINT = "Select a panel to add mask layers to it.";
const NO_LAYERS_HINT = "No mask layers yet. Add one to start labeling regions.";

interface MasksOptionsHeaderProps {
  readonly viewportNumber: number | null;
  readonly onClose: () => void;
}

function MasksOptionsHeader(props: MasksOptionsHeaderProps): JSX.Element {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
      <span className="text-sm font-medium text-foreground">Masks</span>
      <div className="flex items-center gap-2">
        {props.viewportNumber === null ? null : (
          <span className="text-xs text-muted-foreground">Panel {props.viewportNumber}</span>
        )}
        <MasksPanelCloseButton onClose={props.onClose} />
      </div>
    </div>
  );
}

function MasksPanelCloseButton({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Close Masks options" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Close Masks options</TooltipContent>
    </Tooltip>
  );
}

interface MaskLayerListProps {
  readonly target: MasksOptionsTarget;
  readonly onChangeMasks: (next: MaskPanelState) => void;
}

interface MasksOptionsBodyProps extends MaskLayerListProps {
  readonly brush: MaskBrushSettings;
  readonly onChangeBrush: (next: MaskBrushSettings) => void;
  readonly loadedReferenceCandidates: ReadonlyArray<LoadedReferenceCandidate>;
}

function MasksOptionsBody(props: MasksOptionsBodyProps): JSX.Element {
  const selected = findSelectedMaskLayerOrNull(props.target.masks);
  return (
    <>
      <MaskLayerList target={props.target} onChangeMasks={props.onChangeMasks} />
      <NewMaskLayerButton target={props.target} onChangeMasks={props.onChangeMasks} />
      <MaskFileTransferButtons
        width={props.target.width}
        height={props.target.height}
        masks={props.target.masks}
        onChangeMasks={props.onChangeMasks}
      />
      {selected ? <SelectedMaskLayerSections layer={selected} {...props} /> : null}
    </>
  );
}

interface SelectedMaskLayerSectionsProps extends MasksOptionsBodyProps {
  readonly layer: MaskLayer;
}

function SelectedMaskLayerSections(props: SelectedMaskLayerSectionsProps): JSX.Element {
  const onChangeLayer = (next: MaskLayer) =>
    props.onChangeMasks(replaceMaskLayerInPanel(props.target.masks, props.layer.id, () => next));
  return (
    <>
      <MaskBrushControls
        layer={props.layer}
        brush={props.brush}
        onChangeBrush={props.onChangeBrush}
      />
      <MaskThresholdPromotionControl
        layer={props.layer}
        brush={props.brush}
        width={props.target.width}
        height={props.target.height}
        excludeToken={buildLoadedPanelReferenceToken(props.target.viewportNumber, props.target.fileName)}
        loadedReferenceCandidates={props.loadedReferenceCandidates}
        onChangeLayer={onChangeLayer}
      />
      <MaskLayerEditor
        layer={props.layer}
        onChangeLayer={onChangeLayer}
        onDeleteLayer={() =>
          props.onChangeMasks(deleteMaskLayerFromPanel(props.target.masks, props.layer.id))
        }
      />
    </>
  );
}

function MaskLayerList(props: MaskLayerListProps): JSX.Element {
  if (!panelHasMaskLayers(props.target.masks)) {
    return <p className="text-xs text-muted-foreground">{NO_LAYERS_HINT}</p>;
  }
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      aria-label="Mask layers"
      className="flex-col items-stretch gap-1"
      value={props.target.masks.selectedLayerId ?? ""}
      onValueChange={(next) => selectMaskLayerWhenChosen(next, props)}
    >
      {props.target.masks.layers.map((layer) => (
        <ToggleGroupItem key={layer.id} value={layer.id} className="justify-start">
          {layer.name}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

// Radix reports an empty string when the pressed item is clicked again; ignore
// it so exactly one layer stays selected.
function selectMaskLayerWhenChosen(layerId: string, props: MaskLayerListProps): void {
  if (layerId === "") return;
  props.onChangeMasks(selectMaskLayerInPanel(props.target.masks, layerId));
}

function NewMaskLayerButton(props: MaskLayerListProps): JSX.Element {
  return (
    <Button variant="outline" size="sm" onClick={() => props.onChangeMasks(addLayer(props))}>
      New layer
    </Button>
  );
}

function addLayer(props: MaskLayerListProps): MaskPanelState {
  return addNewMaskLayerToPanel(props.target.masks, props.target.width, props.target.height);
}
