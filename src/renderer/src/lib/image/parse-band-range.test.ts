import { describe, expect, it } from "vitest";

import {
  BAND_RANGE_SYNTAX_EXAMPLES,
  BAND_RANGE_SYNTAX_HINT,
  describeBandRangeErrorOrNull,
  formatBandNumbersAsRangeText,
  parseBandRangeText,
} from "./parse-band-range";

describe("parseBandRangeText", () => {
  it("parses a single band number", () => {
    expect(parseBandRangeText("3", 10)).toEqual({ ok: true, bandNumbers: [3] });
  });

  it("parses a comma-separated list of band numbers", () => {
    expect(parseBandRangeText("1,3,5", 10)).toEqual({ ok: true, bandNumbers: [1, 3, 5] });
  });

  it("parses a mixed range-and-list expression", () => {
    expect(parseBandRangeText("1-5,10", 10)).toEqual({
      ok: true,
      bandNumbers: [1, 2, 3, 4, 5, 10],
    });
  });

  it("ignores surrounding and interior whitespace", () => {
    expect(parseBandRangeText("  1 , 3 - 5 ", 10)).toEqual({
      ok: true,
      bandNumbers: [1, 3, 4, 5],
    });
  });

  it("dedupes overlapping ranges into a single ascending set", () => {
    expect(parseBandRangeText("1-3,2-4", 10)).toEqual({
      ok: true,
      bandNumbers: [1, 2, 3, 4],
    });
  });

  it("rejects a descending range with a clear message", () => {
    const result = parseBandRangeText("5-1", 10);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toMatch(/low to high/i);
  });

  it("rejects a band number above the band count", () => {
    const result = parseBandRangeText("11", 10);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toMatch(/out of range/i);
  });

  it("rejects band number zero (bands are 1-based)", () => {
    expect(parseBandRangeText("0", 10).ok).toBe(false);
  });

  it("rejects a range whose upper end exceeds the band count", () => {
    const result = parseBandRangeText("8-12", 10);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toMatch(/out of range/i);
  });

  it("rejects empty or whitespace-only input", () => {
    expect(parseBandRangeText("", 10).ok).toBe(false);
    expect(parseBandRangeText("   ", 10).ok).toBe(false);
  });

  it("rejects non-numeric tokens", () => {
    expect(parseBandRangeText("1,abc", 10).ok).toBe(false);
    expect(parseBandRangeText("1.5", 10).ok).toBe(false);
  });
});

describe("describeBandRangeErrorOrNull", () => {
  it("returns null for a valid expression", () => {
    expect(describeBandRangeErrorOrNull("1-5,10", 10)).toBeNull();
  });

  it("returns the parse error message for an invalid expression", () => {
    expect(describeBandRangeErrorOrNull("99", 10)).toMatch(/out of range/i);
  });

  it("skips range validation when the band count is unknown", () => {
    expect(describeBandRangeErrorOrNull("1-5,10", null)).toBeNull();
  });
});

describe("band-range syntax hint", () => {
  it("documents both a comma list and a dash range example", () => {
    expect(BAND_RANGE_SYNTAX_EXAMPLES).toContain("1,3,5");
    expect(BAND_RANGE_SYNTAX_EXAMPLES).toContain("1-5,10");
  });

  it("warns that ranges use dashes, not colons", () => {
    expect(BAND_RANGE_SYNTAX_HINT).toContain(BAND_RANGE_SYNTAX_EXAMPLES);
    expect(BAND_RANGE_SYNTAX_HINT.toLowerCase()).toContain("not colons");
  });

  it("sources the empty-input error from the shared examples constant", () => {
    const error = describeBandRangeErrorOrNull("", 10);
    expect(error).toContain(BAND_RANGE_SYNTAX_EXAMPLES);
  });
});

describe("formatBandNumbersAsRangeText", () => {
  it("compresses consecutive band numbers into ranges", () => {
    expect(formatBandNumbersAsRangeText([1, 3, 4, 5])).toBe("1,3-5");
  });

  it("renders a single band number plainly", () => {
    expect(formatBandNumbersAsRangeText([3])).toBe("3");
  });

  it("sorts and dedupes before formatting", () => {
    expect(formatBandNumbersAsRangeText([5, 4, 3, 1, 1])).toBe("1,3-5");
  });
});
