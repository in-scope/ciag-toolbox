import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "../..");
const LOGO_SVG_PATH = resolve(REPO_ROOT, "build/logo.svg");
const LOGO_COMPACT_SVG_PATH = resolve(REPO_ROOT, "build/logo-compact.svg");

const LAYERS_SYMBOL_PATHS = [
  'd="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"',
  'd="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"',
  'd="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"',
];

function readSvg(path: string): string {
  return readFileSync(path, "utf8");
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function expectContainsLayersSymbolPaths(svg: string): void {
  for (const path of LAYERS_SYMBOL_PATHS) {
    expect(svg).toContain(path);
  }
}

describe("branding artwork (CT-321)", () => {
  it("logo.svg has the layers symbol and exactly one CHARM text label", () => {
    const svg = readSvg(LOGO_SVG_PATH);
    expectContainsLayersSymbolPaths(svg);
    expect(countOccurrences(svg, "<text")).toBe(1);
    expect(svg).toMatch(/<text[^>]*>CHARM<\/text>/);
  });

  it("logo-compact.svg has the layers symbol and no text element", () => {
    const svg = readSvg(LOGO_COMPACT_SVG_PATH);
    expectContainsLayersSymbolPaths(svg);
    expect(svg).not.toContain("<text");
  });

  it("both artworks keep the 1024 viewBox", () => {
    expect(readSvg(LOGO_SVG_PATH)).toContain('viewBox="0 0 1024 1024"');
    expect(readSvg(LOGO_COMPACT_SVG_PATH)).toContain('viewBox="0 0 1024 1024"');
  });
});
