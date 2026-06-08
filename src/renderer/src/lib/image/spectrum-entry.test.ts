import { describe, expect, it } from "vitest";

import {
  appendPinnedSpectrumWithCapLimit,
  appendRoiSpectrumKeepingLastTwo,
  EMPTY_PINNED_ROI_SPECTRA,
  EMPTY_PINNED_SPECTRA,
  MAX_PINNED_ROI_SPECTRA_PER_VIEWPORT,
  MAX_PINNED_SPECTRA_PER_VIEWPORT,
  removePinnedSpectrumById,
  removeRoiSpectrumById,
  type PinnedRoiMeanSpectrum,
  type PinnedSpectrum,
} from "@/lib/image/spectrum-entry";

function buildPixelSpectrumWithId(id: string): PinnedSpectrum {
  return { kind: "pixel", id, imagePixelX: 0, imagePixelY: 0, bandValues: [1, 2] };
}

function buildRoiSpectrumWithId(id: string): PinnedRoiMeanSpectrum {
  return {
    kind: "roi-mean",
    id,
    samplePixelCount: 4,
    bandMeans: [1, 2],
    bandStandardDeviations: [0.5, 0.5],
  };
}

describe("appendPinnedSpectrumWithCapLimit", () => {
  it("appends below the cap", () => {
    const initial = appendPinnedSpectrumWithCapLimit(
      EMPTY_PINNED_SPECTRA,
      buildPixelSpectrumWithId("a"),
    );
    expect(initial.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("evicts the oldest spectrum when the cap is reached", () => {
    let list = EMPTY_PINNED_SPECTRA;
    for (let n = 0; n < MAX_PINNED_SPECTRA_PER_VIEWPORT; n++) {
      list = appendPinnedSpectrumWithCapLimit(
        list,
        buildPixelSpectrumWithId(`s${n}`),
      );
    }
    expect(list.length).toBe(MAX_PINNED_SPECTRA_PER_VIEWPORT);
    list = appendPinnedSpectrumWithCapLimit(list, buildPixelSpectrumWithId("new"));
    expect(list.length).toBe(MAX_PINNED_SPECTRA_PER_VIEWPORT);
    expect(list[0]?.id).toBe("s1");
    expect(list[list.length - 1]?.id).toBe("new");
  });
});

describe("appendRoiSpectrumKeepingLastTwo", () => {
  it("keeps a single appended ROI spectrum", () => {
    const list = appendRoiSpectrumKeepingLastTwo(
      EMPTY_PINNED_ROI_SPECTRA,
      buildRoiSpectrumWithId("a"),
    );
    expect(list.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("retains the last two ROI spectra", () => {
    const withTwo = appendRoiSpectrumKeepingLastTwo(
      appendRoiSpectrumKeepingLastTwo(EMPTY_PINNED_ROI_SPECTRA, buildRoiSpectrumWithId("a")),
      buildRoiSpectrumWithId("b"),
    );
    expect(withTwo.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(withTwo.length).toBe(MAX_PINNED_ROI_SPECTRA_PER_VIEWPORT);
  });

  it("drops the oldest when a third ROI is added", () => {
    let list = EMPTY_PINNED_ROI_SPECTRA;
    for (const id of ["a", "b", "c"]) {
      list = appendRoiSpectrumKeepingLastTwo(list, buildRoiSpectrumWithId(id));
    }
    expect(list.map((entry) => entry.id)).toEqual(["b", "c"]);
    expect(list.length).toBe(MAX_PINNED_ROI_SPECTRA_PER_VIEWPORT);
  });
});

describe("removeRoiSpectrumById", () => {
  it("removes only the matching ROI spectrum", () => {
    const list = appendRoiSpectrumKeepingLastTwo(
      appendRoiSpectrumKeepingLastTwo(EMPTY_PINNED_ROI_SPECTRA, buildRoiSpectrumWithId("a")),
      buildRoiSpectrumWithId("b"),
    );
    const next = removeRoiSpectrumById(list, "a");
    expect(next.map((entry) => entry.id)).toEqual(["b"]);
  });
});

describe("removePinnedSpectrumById", () => {
  it("removes the matching entry only", () => {
    const list = appendPinnedSpectrumWithCapLimit(
      appendPinnedSpectrumWithCapLimit(EMPTY_PINNED_SPECTRA, buildPixelSpectrumWithId("a")),
      buildPixelSpectrumWithId("b"),
    );
    const next = removePinnedSpectrumById(list, "a");
    expect(next.map((entry) => entry.id)).toEqual(["b"]);
  });

  it("returns the input when no entry matches", () => {
    const list = appendPinnedSpectrumWithCapLimit(
      EMPTY_PINNED_SPECTRA,
      buildPixelSpectrumWithId("a"),
    );
    const next = removePinnedSpectrumById(list, "missing");
    expect(next.map((entry) => entry.id)).toEqual(["a"]);
  });
});
