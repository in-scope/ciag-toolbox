import type { ViewportCellContent } from "@/components/viewport-grid";
import { cloneViewportImageSource } from "@/lib/image/clone-viewport-image-source";
import type { ViewportImageSource } from "@/lib/webgl/texture";

export type ViewportContentMap = ReadonlyMap<number, ViewportCellContent>;
export type ViewportContentMapUpdater = (previous: ViewportContentMap) => ViewportContentMap;

export async function placeClonedSourceContentAtIndex(
  sourceContent: ViewportCellContent,
  targetIndex: number,
  setImagesByIndex: (updater: ViewportContentMapUpdater) => void,
): Promise<ViewportImageSource> {
  const independentSource = await cloneViewportImageSource(sourceContent.source);
  setImagesByIndex((previous) =>
    writeViewportContentAtIndex(previous, targetIndex, {
      fileName: sourceContent.fileName,
      source: independentSource,
      originalFilePath: sourceContent.originalFilePath,
      fileSizeBytes: sourceContent.fileSizeBytes,
    }),
  );
  return independentSource;
}

function writeViewportContentAtIndex(
  previous: ViewportContentMap,
  targetIndex: number,
  content: ViewportCellContent,
): ViewportContentMap {
  const next = new Map(previous);
  next.set(targetIndex, content);
  return next;
}
