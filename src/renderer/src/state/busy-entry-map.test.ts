import { describe, expect, it } from "vitest";

import {
  addBusyEntryToMap,
  pickMostRecentAppBusyEntry,
  pickMostRecentViewportBusyEntry,
  removeBusyEntryFromMap,
  updateBusyEntryInMap,
  type BusyEntry,
  type BusyEntryMap,
} from "./busy-entry-map";

describe("busy entry map helpers", () => {
  it("adds an entry under its id", () => {
    const map = addBusyEntryToMap(new Map(), buildAppEntry("a", 100));
    expect(map.get("a")?.label).toBe("a-label");
  });

  it("removes an entry by id", () => {
    const seeded = addBusyEntryToMap(new Map(), buildAppEntry("a", 100));
    const next = removeBusyEntryFromMap(seeded, "a");
    expect(next.has("a")).toBe(false);
  });

  it("ignores remove when the id is not present", () => {
    const seeded = addBusyEntryToMap(new Map(), buildAppEntry("a", 100));
    const next = removeBusyEntryFromMap(seeded, "missing");
    expect(next).toBe(seeded);
  });

  it("updates the label and progress without mutating the input map", () => {
    const seeded = addBusyEntryToMap(new Map(), buildAppEntry("a", 100));
    const next = updateBusyEntryInMap(seeded, "a", { label: "new", progress: 0.5 });
    expect(next.get("a")?.label).toBe("new");
    expect(next.get("a")?.progress).toBe(0.5);
    expect(seeded.get("a")?.label).toBe("a-label");
  });

  it("ignores update when the id is missing", () => {
    const seeded = addBusyEntryToMap(new Map(), buildAppEntry("a", 100));
    const next = updateBusyEntryInMap(seeded, "missing", { label: "z" });
    expect(next).toBe(seeded);
  });

  it("picks the most recent app entry by registeredAtMs", () => {
    let map: BusyEntryMap = new Map();
    map = addBusyEntryToMap(map, buildAppEntry("a", 100));
    map = addBusyEntryToMap(map, buildAppEntry("b", 200));
    map = addBusyEntryToMap(map, buildAppEntry("c", 150));
    expect(pickMostRecentAppBusyEntry(map)?.id).toBe("b");
  });

  it("returns null when no app entry exists", () => {
    const map = addBusyEntryToMap(new Map(), buildViewportEntry("a", 100, 0));
    expect(pickMostRecentAppBusyEntry(map)).toBeNull();
  });

  it("picks the most recent viewport entry for the matching index only", () => {
    let map: BusyEntryMap = new Map();
    map = addBusyEntryToMap(map, buildViewportEntry("a", 100, 0));
    map = addBusyEntryToMap(map, buildViewportEntry("b", 200, 1));
    map = addBusyEntryToMap(map, buildViewportEntry("c", 300, 0));
    expect(pickMostRecentViewportBusyEntry(map, 0)?.id).toBe("c");
    expect(pickMostRecentViewportBusyEntry(map, 1)?.id).toBe("b");
    expect(pickMostRecentViewportBusyEntry(map, 2)).toBeNull();
  });
});

function buildAppEntry(id: string, registeredAtMs: number): BusyEntry {
  return {
    id,
    scope: "app",
    viewportIndex: null,
    label: `${id}-label`,
    progress: null,
    registeredAtMs,
  };
}

function buildViewportEntry(id: string, registeredAtMs: number, viewportIndex: number): BusyEntry {
  return {
    id,
    scope: "viewport",
    viewportIndex,
    label: `${id}-label`,
    progress: null,
    registeredAtMs,
  };
}
