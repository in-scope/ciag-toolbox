import { describe, expect, it } from "vitest";

import {
  arePanelSizesAllEqual,
  compactPanelLinkGroupsAfterRemovingIndex,
  findLinkGroupContainingPanel,
  getLinkedPanelIndices,
  isPanelLinked,
  linkPanelsIntoOneGroup,
  NO_PANEL_LINK_GROUPS,
  prunePanelLinkGroupsToCellCount,
  unlinkPanelFromItsGroup,
} from "./panel-link-groups";

describe("linkPanelsIntoOneGroup", () => {
  it("links two panels into one sorted group", () => {
    expect(linkPanelsIntoOneGroup(NO_PANEL_LINK_GROUPS, [2, 0])).toEqual([[0, 2]]);
  });

  it("drops a single-panel request to no group", () => {
    expect(linkPanelsIntoOneGroup(NO_PANEL_LINK_GROUPS, [1])).toEqual([]);
  });

  it("merges chained links A-B then B-C into one transitive group", () => {
    const afterAb = linkPanelsIntoOneGroup(NO_PANEL_LINK_GROUPS, [0, 1]);
    expect(linkPanelsIntoOneGroup(afterAb, [1, 2])).toEqual([[0, 1, 2]]);
  });

  it("absorbs two existing groups when the new link spans both", () => {
    const groups = [
      [0, 1],
      [2, 3],
    ];
    expect(linkPanelsIntoOneGroup(groups, [1, 2])).toEqual([[0, 1, 2, 3]]);
  });

  it("leaves unrelated groups untouched", () => {
    const groups = [[3, 4]];
    expect(linkPanelsIntoOneGroup(groups, [0, 1])).toEqual([
      [0, 1],
      [3, 4],
    ]);
  });
});

describe("membership queries", () => {
  const groups = [
    [0, 2],
    [3, 4],
  ];

  it("finds the group containing a panel", () => {
    expect(findLinkGroupContainingPanel(groups, 2)).toEqual([0, 2]);
    expect(findLinkGroupContainingPanel(groups, 1)).toBeNull();
  });

  it("reports linked membership", () => {
    expect(isPanelLinked(groups, 4)).toBe(true);
    expect(isPanelLinked(groups, 1)).toBe(false);
  });

  it("returns the other members as linked indices", () => {
    expect(getLinkedPanelIndices(groups, 0)).toEqual([2]);
    expect(getLinkedPanelIndices(groups, 1)).toEqual([]);
  });
});

describe("arePanelSizesAllEqual", () => {
  it("is true for matching sizes", () => {
    expect(
      arePanelSizesAllEqual([
        { width: 4, height: 4 },
        { width: 4, height: 4 },
      ]),
    ).toBe(true);
  });

  it("is false when any dimension differs", () => {
    expect(
      arePanelSizesAllEqual([
        { width: 4, height: 4 },
        { width: 8, height: 8 },
      ]),
    ).toBe(false);
  });

  it("is false for an empty list", () => {
    expect(arePanelSizesAllEqual([])).toBe(false);
  });
});

describe("unlinkPanelFromItsGroup", () => {
  it("removes a panel and dissolves a group that drops below two", () => {
    expect(unlinkPanelFromItsGroup([[0, 1]], 1)).toEqual([]);
  });

  it("keeps the group when three or more remain", () => {
    expect(unlinkPanelFromItsGroup([[0, 1, 2]], 1)).toEqual([[0, 2]]);
  });
});

describe("compactPanelLinkGroupsAfterRemovingIndex", () => {
  it("removes the closed index and shifts higher indices down", () => {
    expect(compactPanelLinkGroupsAfterRemovingIndex([[0, 2, 3]], 1)).toEqual([[0, 1, 2]]);
  });

  it("dissolves a group that loses a member and drops below two", () => {
    expect(compactPanelLinkGroupsAfterRemovingIndex([[1, 2]], 1)).toEqual([]);
  });
});

describe("prunePanelLinkGroupsToCellCount", () => {
  it("drops members beyond the cell count and dissolves sub-two groups", () => {
    expect(
      prunePanelLinkGroupsToCellCount(
        [
          [0, 1],
          [2, 3],
        ],
        3,
      ),
    ).toEqual([[0, 1]]);
  });
});
