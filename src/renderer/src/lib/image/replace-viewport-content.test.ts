import { describe, expect, it, vi } from "vitest";

import type { ViewportCellContent } from "@/components/viewport-grid";
import { DEFAULT_VIEWPORT_RENDERING_STATE, type ViewportRenderingState } from "@/lib/actions/viewport-action";
import {
  assignViewportContentAtIndex,
  replaceViewportContentResettingPanelState,
  type ReplaceViewportContentBindings,
} from "@/lib/image/replace-viewport-content";

function buildContent(fileName: string): ViewportCellContent {
  return {
    fileName,
    source: { kind: "raster", raster: {} as never },
  };
}

describe("assignViewportContentAtIndex", () => {
  it("sets the content at the given index without mutating the previous map", () => {
    const previous = new Map([[0, buildContent("a.tif")]]);
    const next = assignViewportContentAtIndex(previous, 1, buildContent("b.tif"));
    expect(next.get(1)?.fileName).toBe("b.tif");
    expect(previous.has(1)).toBe(false);
  });
});

describe("replaceViewportContentResettingPanelState", () => {
  it("writes the new content and resets the panel's rendering state to the default", () => {
    let images: ReadonlyMap<number, ViewportCellContent> = new Map([[0, buildContent("old.tif")]]);
    const setImagesByIndex: ReplaceViewportContentBindings["setImagesByIndex"] = vi.fn((action) => {
      images = typeof action === "function" ? action(images) : action;
    });
    const renderingByIndex = new Map<number, ViewportRenderingState>([
      [0, { ...DEFAULT_VIEWPORT_RENDERING_STATE, selectedBandIndex: 2 }],
    ]);
    const setRenderingState = vi.fn((index: number, state: ViewportRenderingState) => {
      renderingByIndex.set(index, state);
    });

    replaceViewportContentResettingPanelState(0, buildContent("new.tif"), {
      setImagesByIndex,
      setRenderingState,
    });

    expect(images.get(0)?.fileName).toBe("new.tif");
    expect(renderingByIndex.get(0)).toBe(DEFAULT_VIEWPORT_RENDERING_STATE);
  });
});
