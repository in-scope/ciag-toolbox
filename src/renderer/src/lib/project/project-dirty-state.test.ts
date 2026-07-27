import { describe, expect, it } from "vitest";

import {
  didAnyPanelContentEntryChange,
  isProjectDirty,
} from "./project-dirty-state";

describe("isProjectDirty", () => {
  it("is clean when the content revision matches the saved revision", () => {
    expect(isProjectDirty({ contentRevision: 3, savedRevision: 3 }, true)).toBe(false);
  });

  it("is dirty when the content revision moved past the saved revision", () => {
    expect(isProjectDirty({ contentRevision: 4, savedRevision: 3 }, true)).toBe(true);
  });

  it("is dirty when unsaved content changes exist even after a later save was recorded lower", () => {
    expect(isProjectDirty({ contentRevision: 7, savedRevision: 5 }, true)).toBe(true);
  });

  it("is never dirty while no panel has content, regardless of revisions", () => {
    expect(isProjectDirty({ contentRevision: 9, savedRevision: 0 }, false)).toBe(false);
  });

  it("treats a fresh empty session as clean", () => {
    expect(isProjectDirty({ contentRevision: 0, savedRevision: 0 }, false)).toBe(false);
  });
});

describe("didAnyPanelContentEntryChange (the revision-increment classification)", () => {
  const contentA = { fileName: "a.tif" };
  const contentB = { fileName: "b.tif" };

  it("classifies loading content into a panel as a content change", () => {
    const previous = new Map<number, unknown>();
    const next = new Map<number, unknown>([[0, contentA]]);
    expect(didAnyPanelContentEntryChange(previous, next)).toBe(true);
  });

  it("classifies replacing a panel's content (an in-place apply) as a content change", () => {
    const previous = new Map<number, unknown>([[0, contentA]]);
    const next = new Map<number, unknown>([[0, { ...contentA }]]);
    expect(didAnyPanelContentEntryChange(previous, next)).toBe(true);
  });

  it("classifies closing a panel as a content change", () => {
    const previous = new Map<number, unknown>([
      [0, contentA],
      [1, contentB],
    ]);
    const next = new Map<number, unknown>([[0, contentA]]);
    expect(didAnyPanelContentEntryChange(previous, next)).toBe(true);
  });

  it("classifies duplicating a panel into a new cell as a content change", () => {
    const previous = new Map<number, unknown>([[0, contentA]]);
    const next = new Map<number, unknown>([
      [0, contentA],
      [1, contentB],
    ]);
    expect(didAnyPanelContentEntryChange(previous, next)).toBe(true);
  });

  it("classifies a display-only change (same map instance untouched) as no content change", () => {
    const unchanged = new Map<number, unknown>([[0, contentA]]);
    expect(didAnyPanelContentEntryChange(unchanged, unchanged)).toBe(false);
  });

  it("classifies a rebuilt map carrying the same content entries as no content change", () => {
    const previous = new Map<number, unknown>([[0, contentA]]);
    const next = new Map<number, unknown>([[0, contentA]]);
    expect(didAnyPanelContentEntryChange(previous, next)).toBe(false);
  });
});
