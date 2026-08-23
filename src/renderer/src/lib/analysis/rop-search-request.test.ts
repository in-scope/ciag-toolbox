import { describe, expect, it } from "vitest";

import {
  buildMaskCategoryAtIndex,
  createMaskLayer,
  type MaskLayer,
} from "@/lib/masks/mask-layer";

import {
  buildRopSearchExecuteParams,
  buildRopSearchRunExtras,
  DEFAULT_ROP_SEARCH_PROJECTION_COUNT,
  parseRopSearchProjectionCountOrNull,
  type RopSearchRunRequest,
} from "./rop-search-request";

// Categories 2 and 3 are painted, category 1 is not, so the uploaded mask list
// is [category 2, category 3] and the CNR indexes must skip the empty one.
function buildTwoPaintedCategoryLayer(): MaskLayer {
  const layer = createMaskLayer("mask-1", "Labels", 2, 2);
  return {
    ...layer,
    categories: [...layer.categories, buildMaskCategoryAtIndex(2, "Ink", "#22c55e")],
    values: Uint8Array.from([2, 2, 3, 3]),
  };
}

function buildSearchRequest(overrides: Partial<RopSearchRunRequest> = {}): RopSearchRunRequest {
  return {
    seed: 7,
    projectionCount: 50,
    objectiveKind: "cnr",
    maskLayer: buildTwoPaintedCategoryLayer(),
    npcBinCount: 255,
    cnrTextCategoryValue: 3,
    cnrBackgroundCategoryValue: 2,
    customObjectiveSource: null,
    ...overrides,
  };
}

describe("parseRopSearchProjectionCountOrNull", () => {
  it("accepts a whole positive count", () => {
    expect(parseRopSearchProjectionCountOrNull("10000")).toBe(10_000);
    expect(parseRopSearchProjectionCountOrNull(" 1 ")).toBe(1);
  });

  it("rejects zero, empty, fractional, and non-numeric text", () => {
    expect(parseRopSearchProjectionCountOrNull("0")).toBeNull();
    expect(parseRopSearchProjectionCountOrNull("")).toBeNull();
    expect(parseRopSearchProjectionCountOrNull("1.5")).toBeNull();
    expect(parseRopSearchProjectionCountOrNull("-3")).toBeNull();
    expect(parseRopSearchProjectionCountOrNull("many")).toBeNull();
  });

  it("defaults the panel field to ten thousand projections", () => {
    expect(DEFAULT_ROP_SEARCH_PROJECTION_COUNT).toBe(10_000);
  });
});

describe("buildRopSearchExecuteParams", () => {
  it("sends the seed, the candidate count, and the objective name", () => {
    const params = buildRopSearchExecuteParams(buildSearchRequest());
    expect(params).toMatchObject({ seed: 7, count: 50, objective: "cnr" });
  });

  it("addresses the CNR categories by their position in the uploaded mask list", () => {
    const params = buildRopSearchExecuteParams(buildSearchRequest());
    expect(params).toMatchObject({ text_mask_index: 1, background_mask_index: 0 });
  });

  it("sends the clamped bin count for the NPC objective", () => {
    const params = buildRopSearchExecuteParams(
      buildSearchRequest({ objectiveKind: "npc", npcBinCount: 1 }),
    );
    expect(params).toMatchObject({ objective: "npc", bins: 2 });
    expect(params).not.toHaveProperty("text_mask_index");
  });

  it("sends the custom objective's source so every candidate is scored with it", () => {
    const params = buildRopSearchExecuteParams(
      buildSearchRequest({ objectiveKind: "custom", customObjectiveSource: "def run(cube): 1" }),
    );
    expect(params).toMatchObject({ objective: "custom", objective_source: "def run(cube): 1" });
  });

  it("keeps the count a whole number of at least one", () => {
    expect(buildRopSearchExecuteParams(buildSearchRequest({ projectionCount: 0 }))).toMatchObject({
      count: 1,
    });
    expect(buildRopSearchExecuteParams(buildSearchRequest({ projectionCount: 9.7 }))).toMatchObject({
      count: 9,
    });
  });
});

describe("buildRopSearchRunExtras", () => {
  it("uploads one binary mask per painted category, in category order", () => {
    const extras = buildRopSearchRunExtras(buildSearchRequest());
    expect(extras.masks).toHaveLength(2);
    expect(Array.from(extras.masks?.[0] ?? [])).toEqual([1, 1, 0, 0]);
    expect(Array.from(extras.masks?.[1] ?? [])).toEqual([0, 0, 1, 1]);
  });

  it("uploads no masks when the objective needs no labels", () => {
    const extras = buildRopSearchRunExtras(
      buildSearchRequest({ objectiveKind: "custom", maskLayer: null }),
    );
    expect(extras.masks).toEqual([]);
  });
});
