import { describe, expect, it } from "vitest";

import { parseProjectFileFromJsonString } from "./parse-project";
import { PROJECT_FILE_FORMAT_VERSION } from "./project-schema";

describe("parseProjectFileFromJsonString", () => {
  it("parses a minimal valid project file with one viewport", () => {
    const json = buildValidProjectJsonWithSingleViewport();
    const project = parseProjectFileFromJsonString(json);
    expect(project.formatVersion).toBe(PROJECT_FILE_FORMAT_VERSION);
    expect(project.gridLayout).toBe("1x1");
    expect(project.viewports).toHaveLength(1);
    const [first] = project.viewports;
    expect(first?.source.relativePath).toBe("./images/sample.tif");
    expect(first?.source.contentHash).toBe("abc123");
    expect(first?.source.fileName).toBe("sample.tif");
    expect(first?.renderingState.normalizationEnabled).toBe(true);
    expect(first?.renderingState.selectedBandIndex).toBe(2);
  });

  it("falls back to identity view transform when missing", () => {
    const project = parseProjectFileFromJsonString(buildProjectJsonWithoutViewTransform());
    const [first] = project.viewports;
    expect(first?.viewTransform.zoom).toBe(1);
    expect(first?.viewTransform.panX).toBe(0);
    expect(first?.viewTransform.panY).toBe(0);
  });

  it("captures the selected viewport indices array", () => {
    const project = parseProjectFileFromJsonString(buildValidProjectJsonWithSingleViewport());
    expect(project.selectedViewportIndices).toEqual([0]);
  });

  it("rejects an unsupported format version with a clear error", () => {
    const json = JSON.stringify({ formatVersion: 99, gridLayout: "1x1", selectedViewportIndices: [], viewports: [] });
    expect(() => parseProjectFileFromJsonString(json)).toThrow(
      /Unsupported project file format version/,
    );
  });

  it("rejects an unknown grid layout", () => {
    const json = JSON.stringify({
      formatVersion: PROJECT_FILE_FORMAT_VERSION,
      gridLayout: "5x5",
      selectedViewportIndices: [],
      viewports: [],
    });
    expect(() => parseProjectFileFromJsonString(json)).toThrow(/Unknown grid layout/);
  });

  it("rejects a non-object JSON root", () => {
    expect(() => parseProjectFileFromJsonString("[]")).toThrow();
    expect(() => parseProjectFileFromJsonString("\"hello\"")).toThrow();
  });

  it("rejects a viewport entry missing the source.contentHash field", () => {
    const json = buildProjectJsonWithoutContentHash();
    expect(() => parseProjectFileFromJsonString(json)).toThrow(
      /source\.contentHash must be a non-empty string/,
    );
  });
});

function buildValidProjectJsonWithSingleViewport(): string {
  return JSON.stringify({
    formatVersion: PROJECT_FILE_FORMAT_VERSION,
    gridLayout: "1x1",
    selectedViewportIndices: [0],
    viewports: [
      {
        index: 0,
        source: { relativePath: "./images/sample.tif", contentHash: "abc123", fileName: "sample.tif" },
        renderingState: {
          normalizationEnabled: true,
          selectedBandIndex: 2,
          lastAppliedOperationLabel: null,
        },
        viewTransform: { zoom: 2, panX: 0.1, panY: -0.5 },
        operationHistory: [],
        roi: null,
      },
    ],
  });
}

function buildProjectJsonWithoutViewTransform(): string {
  return JSON.stringify({
    formatVersion: PROJECT_FILE_FORMAT_VERSION,
    gridLayout: "1x1",
    selectedViewportIndices: [],
    viewports: [
      {
        index: 0,
        source: { relativePath: "a.tif", contentHash: "h", fileName: "a.tif" },
        renderingState: {
          normalizationEnabled: false,
          selectedBandIndex: 0,
          lastAppliedOperationLabel: null,
        },
        operationHistory: [],
        roi: null,
      },
    ],
  });
}

function buildProjectJsonWithoutContentHash(): string {
  return JSON.stringify({
    formatVersion: PROJECT_FILE_FORMAT_VERSION,
    gridLayout: "1x1",
    selectedViewportIndices: [],
    viewports: [
      {
        index: 0,
        source: { relativePath: "a.tif", fileName: "a.tif" },
        renderingState: {
          normalizationEnabled: false,
          selectedBandIndex: 0,
          lastAppliedOperationLabel: null,
        },
        operationHistory: [],
        roi: null,
      },
    ],
  });
}
