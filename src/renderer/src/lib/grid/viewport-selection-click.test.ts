import { describe, expect, it } from "vitest";

import {
  collectPanelIndicesToLinkFromSelection,
  computeSelectionAfterClick,
  computeSelectionAfterContextMenuClick,
  extractClickModifiers,
} from "./viewport-selection-click";

describe("extractClickModifiers", () => {
  it("maps a Mac Cmd-click (metaKey) to ctrlOrMeta", () => {
    const modifiers = extractClickModifiers({ ctrlKey: false, metaKey: true, shiftKey: false });
    expect(modifiers).toEqual({ ctrlOrMeta: true, shift: false });
  });

  it("maps a Windows Ctrl-click to ctrlOrMeta", () => {
    const modifiers = extractClickModifiers({ ctrlKey: true, metaKey: false, shiftKey: false });
    expect(modifiers).toEqual({ ctrlOrMeta: true, shift: false });
  });

  it("maps a plain click to no modifiers", () => {
    const modifiers = extractClickModifiers({ ctrlKey: false, metaKey: false, shiftKey: false });
    expect(modifiers).toEqual({ ctrlOrMeta: false, shift: false });
  });

  it("carries the shift key through", () => {
    const modifiers = extractClickModifiers({ ctrlKey: false, metaKey: false, shiftKey: true });
    expect(modifiers).toEqual({ ctrlOrMeta: false, shift: true });
  });
});

describe("computeSelectionAfterClick", () => {
  it("replaces the selection and moves the anchor on a plain click", () => {
    const result = computeSelectionAfterClick(new Set([0, 1]), 0, 2, {
      ctrlOrMeta: false,
      shift: false,
    });
    expect([...result.selection]).toEqual([2]);
    expect(result.anchor).toBe(2);
  });

  it("adds an unselected panel on a Cmd/Ctrl-click, keeping the rest", () => {
    const result = computeSelectionAfterClick(new Set([0]), 0, 2, {
      ctrlOrMeta: true,
      shift: false,
    });
    expect([...result.selection].sort()).toEqual([0, 2]);
    expect(result.anchor).toBe(2);
  });

  it("removes an already-selected panel on a Cmd/Ctrl-click", () => {
    const result = computeSelectionAfterClick(new Set([0, 2]), 0, 2, {
      ctrlOrMeta: true,
      shift: false,
    });
    expect([...result.selection]).toEqual([0]);
    expect(result.anchor).toBe(2);
  });

  it("selects the row-major range from the anchor on a Shift-click, keeping the anchor", () => {
    const result = computeSelectionAfterClick(new Set([1]), 1, 3, {
      ctrlOrMeta: false,
      shift: true,
    });
    expect([...result.selection].sort()).toEqual([1, 2, 3]);
    expect(result.anchor).toBe(1);
  });

  it("falls back to a plain click on a Shift-click without an anchor", () => {
    const result = computeSelectionAfterClick(new Set([0]), null, 2, {
      ctrlOrMeta: false,
      shift: true,
    });
    expect([...result.selection]).toEqual([2]);
    expect(result.anchor).toBe(2);
  });
});

describe("computeSelectionAfterContextMenuClick", () => {
  it("selects an unselected panel alone before the menu opens", () => {
    const result = computeSelectionAfterContextMenuClick(new Set([0]), 0, 2);
    expect([...result.selection]).toEqual([2]);
    expect(result.anchor).toBe(2);
  });

  it("keeps a multi-selection intact when the clicked panel is already selected", () => {
    const previous = new Set([0, 2]);
    const result = computeSelectionAfterContextMenuClick(previous, 0, 2);
    expect(result.selection).toBe(previous);
    expect(result.anchor).toBe(0);
  });
});

describe("collectPanelIndicesToLinkFromSelection", () => {
  it("unions the selection with the context-menu panel", () => {
    expect([...collectPanelIndicesToLinkFromSelection(new Set([0, 1]), 2)].sort()).toEqual([
      0, 1, 2,
    ]);
  });

  it("does not duplicate a panel already in the selection", () => {
    expect([...collectPanelIndicesToLinkFromSelection(new Set([0, 2]), 2)].sort()).toEqual([0, 2]);
  });

  it("yields only the panel under the cursor for an empty selection", () => {
    expect([...collectPanelIndicesToLinkFromSelection(new Set(), 1)]).toEqual([1]);
  });
});
