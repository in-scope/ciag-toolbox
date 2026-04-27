import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type MouseEvent,
  type SetStateAction,
} from "react";
import { toast } from "sonner";

import { AboutDialog } from "@/components/about-dialog";
import { Toolbar } from "@/components/toolbar";
import { Toaster } from "@/components/ui/sonner";
import { ViewportGrid, type ViewportCellContent } from "@/components/viewport-grid";
import {
  getGridLayoutCellCount,
  getViewportNumberFromIndex,
  type GridLayout,
} from "@/lib/grid/grid-layout";
import { decodeImageBytesToViewportSource } from "@/lib/image/decode-image-bytes";
import { ViewportSelectionProvider, useViewportSelection } from "@/state/selection-context";

const DEFAULT_GRID_LAYOUT: GridLayout = "1x1";
const DEFAULT_OPEN_TARGET_VIEWPORT_INDEX = 0;

type ImagesByIndexMap = ReadonlyMap<number, ViewportCellContent>;
type SetImagesByIndex = Dispatch<SetStateAction<ImagesByIndexMap>>;

export function App(): JSX.Element {
  return (
    <ViewportSelectionProvider>
      <ApplicationShell />
      <AboutDialog />
      <Toaster />
    </ViewportSelectionProvider>
  );
}

function ApplicationShell(): JSX.Element {
  const [gridLayout, setGridLayout] = useState<GridLayout>(DEFAULT_GRID_LAYOUT);
  const [imagesByIndex, setImagesByIndex] = useState<ImagesByIndexMap>(createEmptyImagesMap);
  const { pruneSelectionToCellCount } = useViewportSelection();
  const handleGridLayoutChange = createGridLayoutChangeHandler({
    currentLayout: gridLayout,
    imagesByIndex,
    setGridLayout,
    setImagesByIndex,
    pruneSelectionToCellCount,
  });
  const handleOpenImageRequested = useOpenImageThroughDialogHandler(setImagesByIndex);
  const handleApplyToSelected = useCallback(logApplyToSelected, []);
  useMenuOpenImageTriggersHandler(handleOpenImageRequested);
  return (
    <div className="flex h-full flex-col">
      <Toolbar
        onOpenImage={handleOpenImageRequested}
        gridLayout={gridLayout}
        onGridLayoutChange={handleGridLayoutChange}
        onApplyToSelected={handleApplyToSelected}
      />
      <ApplicationStageContent gridLayout={gridLayout} imagesByIndex={imagesByIndex} />
    </div>
  );
}

function createEmptyImagesMap(): ImagesByIndexMap {
  return new Map();
}

function ApplicationStageContent({
  gridLayout,
  imagesByIndex,
}: {
  gridLayout: GridLayout;
  imagesByIndex: ImagesByIndexMap;
}): JSX.Element {
  const { clearSelection } = useViewportSelection();
  return (
    <main
      className="flex min-h-0 flex-1 p-4"
      onClick={(event) => clearSelectionWhenClickIsOutsideAnyCell(event, clearSelection)}
    >
      <ViewportGrid layout={gridLayout} cellsByIndex={imagesByIndex} />
    </main>
  );
}

function clearSelectionWhenClickIsOutsideAnyCell(
  event: MouseEvent<HTMLElement>,
  clearSelection: () => void,
): void {
  const targetElement = event.target as HTMLElement;
  if (targetElement.closest('[role="gridcell"]')) return;
  clearSelection();
}

function useMenuOpenImageTriggersHandler(handler: () => void): void {
  useEffect(() => window.toolboxApi.onMenuOpenImage(handler), [handler]);
}

function useOpenImageThroughDialogHandler(setImagesByIndex: SetImagesByIndex): () => Promise<void> {
  return useCallback(async () => {
    await runOpenImageDialogFlow(setImagesByIndex);
  }, [setImagesByIndex]);
}

async function runOpenImageDialogFlow(setImagesByIndex: SetImagesByIndex): Promise<void> {
  const result = await invokeOpenImageDialogSafely();
  if (!result || result.canceled) return;
  await tryDecodeAndApplyImage(result.fileName, result.bytes, setImagesByIndex);
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
  setImagesByIndex: SetImagesByIndex,
): Promise<void> {
  try {
    const source = await decodeImageBytesToViewportSource(bytes);
    setImagesByIndex((previous) =>
      assignViewportContentAtIndex(previous, DEFAULT_OPEN_TARGET_VIEWPORT_INDEX, {
        fileName,
        source,
      }),
    );
    toast.success(`Loaded ${fileName}`);
  } catch (error) {
    toast.error(`Could not open ${fileName}: ${describeUnknownError(error)}`);
  }
}

function assignViewportContentAtIndex(
  previous: ImagesByIndexMap,
  index: number,
  content: ViewportCellContent,
): ImagesByIndexMap {
  const next = new Map(previous);
  next.set(index, content);
  return next;
}

interface GridLayoutChangeBindings {
  currentLayout: GridLayout;
  imagesByIndex: ImagesByIndexMap;
  setGridLayout: (layout: GridLayout) => void;
  setImagesByIndex: SetImagesByIndex;
  pruneSelectionToCellCount: (cellCount: number) => void;
}

function createGridLayoutChangeHandler(
  bindings: GridLayoutChangeBindings,
): (layout: GridLayout) => void {
  return (newLayout) => applyGridLayoutChange(newLayout, bindings);
}

function applyGridLayoutChange(newLayout: GridLayout, bindings: GridLayoutChangeBindings): void {
  if (newLayout === bindings.currentLayout) return;
  const newCellCount = getGridLayoutCellCount(newLayout);
  notifyAboutClosedLoadedViewports(bindings.imagesByIndex, newCellCount);
  bindings.setImagesByIndex(filterImagesToWithinCellCount(bindings.imagesByIndex, newCellCount));
  bindings.pruneSelectionToCellCount(newCellCount);
  bindings.setGridLayout(newLayout);
}

function notifyAboutClosedLoadedViewports(
  imagesByIndex: ImagesByIndexMap,
  newCellCount: number,
): void {
  const closed = collectClosedLoadedViewports(imagesByIndex, newCellCount);
  if (closed.length === 0) return;
  toast.info(formatClosedViewportsMessage(closed));
}

interface ClosedViewportSummary {
  readonly viewportNumber: number;
  readonly fileName: string;
}

function collectClosedLoadedViewports(
  imagesByIndex: ImagesByIndexMap,
  newCellCount: number,
): ReadonlyArray<ClosedViewportSummary> {
  const closed: ClosedViewportSummary[] = [];
  for (const [index, content] of imagesByIndex) {
    if (index < newCellCount) continue;
    closed.push({
      viewportNumber: getViewportNumberFromIndex(index),
      fileName: content.fileName,
    });
  }
  return closed.sort((a, b) => a.viewportNumber - b.viewportNumber);
}

function formatClosedViewportsMessage(closed: ReadonlyArray<ClosedViewportSummary>): string {
  if (closed.length === 1) {
    const only = closed[0]!;
    return `Closed viewport ${only.viewportNumber} (${only.fileName})`;
  }
  const list = closed.map((entry) => `${entry.viewportNumber} (${entry.fileName})`).join(", ");
  return `Closed viewports: ${list}`;
}

function filterImagesToWithinCellCount(
  imagesByIndex: ImagesByIndexMap,
  newCellCount: number,
): ImagesByIndexMap {
  const next = new Map<number, ViewportCellContent>();
  for (const [index, content] of imagesByIndex) {
    if (index < newCellCount) next.set(index, content);
  }
  return next;
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function logApplyToSelected(): void {
  console.info("[toolbox] apply to selected requested");
}
