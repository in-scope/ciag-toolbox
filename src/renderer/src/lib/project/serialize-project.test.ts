import { describe, expect, it } from "vitest";

import { PROJECT_FILE_FORMAT_VERSION } from "./project-schema";
import {
  buildDraftProjectFileFromSnapshot,
  type SaveableProjectSnapshot,
} from "./serialize-project";

describe("buildDraftProjectFileFromSnapshot", () => {
  it("emits the supported format version constant", () => {
    const draft = buildDraftProjectFileFromSnapshot(buildSingleViewportSnapshot());
    expect(draft.formatVersion).toBe(PROJECT_FILE_FORMAT_VERSION);
  });

  it("preserves the absolute path on each viewport entry", () => {
    const draft = buildDraftProjectFileFromSnapshot(buildSingleViewportSnapshot());
    const [first] = draft.viewports;
    expect(first?.source.absolutePath).toBe("/abs/path/to/sample.tif");
    expect(first?.source.contentHash).toBe("hash123");
    expect(first?.source.fileName).toBe("sample.tif");
  });

  it("sorts the selected viewport indices ascending", () => {
    const snapshot: SaveableProjectSnapshot = {
      ...buildSingleViewportSnapshot(),
      selectedViewportIndices: [3, 1, 2],
    };
    const draft = buildDraftProjectFileFromSnapshot(snapshot);
    expect(draft.selectedViewportIndices).toEqual([1, 2, 3]);
  });

  it("forwards rendering state values onto each viewport entry", () => {
    const draft = buildDraftProjectFileFromSnapshot(buildSingleViewportSnapshot());
    const [first] = draft.viewports;
    expect(first?.renderingState.normalizationEnabled).toBe(true);
    expect(first?.renderingState.selectedBandIndex).toBe(0);
    expect(first?.renderingState.lastAppliedOperationLabel).toBeNull();
  });

  it("forwards each viewport's operationHistory entries unchanged", () => {
    const snapshot: SaveableProjectSnapshot = {
      ...buildSingleViewportSnapshot(),
      viewports: [
        {
          ...buildSingleViewportSnapshot().viewports[0]!,
          operationHistory: [
            {
              actionId: "bit-shift",
              actionLabel: "Bit Shift",
              appliedLabel: "Bit shift +4",
              parameterValues: { shiftAmount: 4 },
              timestampMs: 1_700_000_000_000,
            },
          ],
        },
      ],
    };
    const draft = buildDraftProjectFileFromSnapshot(snapshot);
    expect(draft.viewports[0]?.operationHistory).toHaveLength(1);
    expect(draft.viewports[0]?.operationHistory[0]?.actionId).toBe("bit-shift");
    expect(draft.viewports[0]?.operationHistory[0]?.parameterValues).toEqual({ shiftAmount: 4 });
  });
});

function buildSingleViewportSnapshot(): SaveableProjectSnapshot {
  return {
    gridLayout: "1x1",
    selectedViewportIndices: [0],
    viewports: [
      {
        index: 0,
        originalFilePath: "/abs/path/to/sample.tif",
        originalContentHash: "hash123",
        fileName: "sample.tif",
        renderingState: {
          normalizationEnabled: true,
          selectedBandIndex: 0,
          lastAppliedOperationLabel: null,
        },
        operationHistory: [],
      },
    ],
  };
}
