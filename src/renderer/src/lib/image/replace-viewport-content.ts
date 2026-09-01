import type { Dispatch, SetStateAction } from "react";

import type { ViewportCellContent } from "@/components/viewport-grid";
import { DEFAULT_VIEWPORT_RENDERING_STATE, type ViewportRenderingState } from "@/lib/actions/viewport-action";

type ImagesByIndexMap = ReadonlyMap<number, ViewportCellContent>;

export interface ReplaceViewportContentBindings {
  setImagesByIndex: Dispatch<SetStateAction<ImagesByIndexMap>>;
  setRenderingState: (viewportIndex: number, next: ViewportRenderingState) => void;
}

// CT-323: shared by the open-with-replace and re-import paths so a panel that
// already holds a stack always arrives clean - masks, band selection, and
// History never attach to the stack that just replaced it.
export function replaceViewportContentResettingPanelState(
  index: number,
  content: ViewportCellContent,
  bindings: ReplaceViewportContentBindings,
): void {
  bindings.setImagesByIndex((previous) => assignViewportContentAtIndex(previous, index, content));
  bindings.setRenderingState(index, DEFAULT_VIEWPORT_RENDERING_STATE);
}

export function assignViewportContentAtIndex(
  previous: ImagesByIndexMap,
  index: number,
  content: ViewportCellContent,
): ImagesByIndexMap {
  const next = new Map(previous);
  next.set(index, content);
  return next;
}
