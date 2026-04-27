import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { AboutDialog } from "@/components/about-dialog";
import { Toolbar, type GridLayout } from "@/components/toolbar";
import { Toaster } from "@/components/ui/sonner";
import { Viewport } from "@/components/viewport";
import { decodeImageBytesToViewportSource } from "@/lib/image/decode-image-bytes";
import type { ViewportImageSource } from "@/lib/webgl/texture";

const DEFAULT_GRID_LAYOUT: GridLayout = "1x1";

interface LoadedImage {
  fileName: string;
  source: ViewportImageSource;
}

export function App(): JSX.Element {
  const [gridLayout, setGridLayout] = useState<GridLayout>(DEFAULT_GRID_LAYOUT);
  const [loadedImage, setLoadedImage] = useState<LoadedImage | null>(null);
  const handleOpenImageRequested = useOpenImageThroughDialogHandler(setLoadedImage);
  const handleApplyToSelected = useCallback(logApplyToSelected, []);
  useMenuOpenImageTriggersHandler(handleOpenImageRequested);
  return (
    <div className="flex h-full flex-col">
      <Toolbar
        onOpenImage={handleOpenImageRequested}
        gridLayout={gridLayout}
        onGridLayoutChange={setGridLayout}
        selectedViewportCount={0}
        onApplyToSelected={handleApplyToSelected}
      />
      <ApplicationStageContent loadedImage={loadedImage} />
      <AboutDialog />
      <Toaster />
    </div>
  );
}

function ApplicationStageContent({
  loadedImage,
}: {
  loadedImage: LoadedImage | null;
}): JSX.Element {
  return (
    <main className="flex min-h-0 flex-1 p-4">
      <Viewport
        imageSource={loadedImage?.source ?? null}
        fileName={loadedImage?.fileName ?? null}
      />
    </main>
  );
}

function useMenuOpenImageTriggersHandler(handler: () => void): void {
  useEffect(() => window.toolboxApi.onMenuOpenImage(handler), [handler]);
}

function useOpenImageThroughDialogHandler(
  setLoadedImage: (loaded: LoadedImage) => void,
): () => Promise<void> {
  return useCallback(async () => {
    await runOpenImageDialogFlow(setLoadedImage);
  }, [setLoadedImage]);
}

async function runOpenImageDialogFlow(
  setLoadedImage: (loaded: LoadedImage) => void,
): Promise<void> {
  const result = await invokeOpenImageDialogSafely();
  if (!result || result.canceled) return;
  await tryDecodeAndApplyImage(result.fileName, result.bytes, setLoadedImage);
}

async function invokeOpenImageDialogSafely(): Promise<ToolboxOpenImageDialogResult | null> {
  try {
    return await window.toolboxApi.openImageDialog();
  } catch (error) {
    toast.error(`Could not open the file dialog: ${describeUnknownError(error)}`);
    return null;
  }
}

async function tryDecodeAndApplyImage(
  fileName: string,
  bytes: Uint8Array,
  setLoadedImage: (loaded: LoadedImage) => void,
): Promise<void> {
  try {
    const source = await decodeImageBytesToViewportSource(bytes);
    setLoadedImage({ fileName, source });
    toast.success(`Loaded ${fileName}`);
  } catch (error) {
    toast.error(`Could not open ${fileName}: ${describeUnknownError(error)}`);
  }
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function logApplyToSelected(): void {
  console.info("[toolbox] apply to selected requested");
}
