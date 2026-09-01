import { Download, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { describeElectronInvokeFailure } from "@/lib/ipc/electron-invoke-error";
import type { MaskLayer } from "@/lib/masks/mask-layer";
import {
  addImportedMaskLayerToPanel,
  findSelectedMaskLayerOrNull,
  type MaskPanelState,
} from "@/lib/masks/mask-panel";
import { exportMaskLayerThroughSaveDialog } from "@/lib/masks/run-mask-export-flow";
import { importMaskLayerThroughOpenDialog } from "@/lib/masks/run-mask-import-flow";
import { notifyError, notifySuccess } from "@/lib/notifications/notify";

// CT-303: the Masks aside's file row. Import adds the picked files as ONE new
// layer on the active panel (refusing a mask that does not cover the stack);
// CT-327: Export writes the SELECTED layer as one zip holding a black-and-white
// PNG per category plus the index PNG of category indexes and its JSON sidecar.
// CT-328: a pick is one PNG, several PNGs (one category per file), or one zip,
// so the button's label stays "Import mask" while the flow decides the shape.

export interface MaskFileTransferButtonsProps {
  readonly width: number;
  readonly height: number;
  readonly masks: MaskPanelState;
  readonly onChangeMasks: (next: MaskPanelState) => void;
}

export function MaskFileTransferButtons(props: MaskFileTransferButtonsProps): JSX.Element {
  const selected = findSelectedMaskLayerOrNull(props.masks);
  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        className="flex-1"
        onClick={() => void importMaskAddingItAsALayer(props)}
      >
        <Upload className="size-4" />
        Import mask
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="flex-1"
        disabled={selected === null}
        onClick={() => void exportSelectedMaskLayer(selected)}
      >
        <Download className="size-4" />
        Export mask
      </Button>
    </div>
  );
}

async function importMaskAddingItAsALayer(props: MaskFileTransferButtonsProps): Promise<void> {
  try {
    const imported = await importMaskLayerThroughOpenDialog({
      width: props.width,
      height: props.height,
    });
    if (imported.canceled) return;
    props.onChangeMasks(addImportedMaskLayerToPanel(props.masks, imported.content));
    notifySuccess(`Imported mask ${imported.content.name}`);
  } catch (error) {
    notifyError(describeElectronInvokeFailure(error));
  }
}

async function exportSelectedMaskLayer(layer: MaskLayer | null): Promise<void> {
  if (layer === null) return;
  try {
    const exported = await exportMaskLayerThroughSaveDialog(layer);
    if (exported.canceled) return;
    notifySuccess(`Saved mask to ${exported.filePath}`);
  } catch (error) {
    notifyError(`Could not export the mask: ${describeElectronInvokeFailure(error)}`);
  }
}
