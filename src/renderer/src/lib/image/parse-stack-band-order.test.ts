import { describe, expect, it } from "vitest";

import { parseStackBandOrderSuggestion } from "./parse-stack-band-order";

describe("parseStackBandOrderSuggestion", () => {
  it("returns empty suggestion when given no file names", () => {
    const result = parseStackBandOrderSuggestion([]);
    expect(result.suggestedRowOrder).toEqual([]);
    expect(result.hadConfidentWavelengthParse).toBe(false);
  });

  it("parses wavelengths from clean unique-wavelength file names and sorts ascending", () => {
    const result = parseStackBandOrderSuggestion([
      "capture-450-band.tif",
      "capture-365-band.tif",
      "capture-700-band.tif",
    ]);
    expect(result.hadConfidentWavelengthParse).toBe(true);
    expect(result.suggestedRowOrder).toEqual([
      "capture-365-band.tif",
      "capture-450-band.tif",
      "capture-700-band.tif",
    ]);
    expect(result.parsedWavelengthByFileName.get("capture-365-band.tif")).toBe(365);
  });

  it("captures the differentiating middle substring between the common prefix and suffix", () => {
    const result = parseStackBandOrderSuggestion([
      "capture-450-band.tif",
      "capture-365-band.tif",
    ]);
    expect(result.differentiatingSubstringByFileName.get("capture-450-band.tif")).toBe("450");
    expect(result.differentiatingSubstringByFileName.get("capture-365-band.tif")).toBe("365");
  });

  it("falls back to alphabetical when wavelengths repeat across files", () => {
    const result = parseStackBandOrderSuggestion([
      "card-365G_017_R.tif",
      "card-365N_023_R.tif",
      "card-365R_019_R.tif",
    ]);
    expect(result.hadConfidentWavelengthParse).toBe(false);
    expect(result.suggestedRowOrder).toEqual([
      "card-365G_017_R.tif",
      "card-365N_023_R.tif",
      "card-365R_019_R.tif",
    ]);
  });

  it("rejects wavelengths outside the plausible 200 to 2500 nm window", () => {
    const result = parseStackBandOrderSuggestion([
      "scan-150-band.tif",
      "scan-3000-band.tif",
    ]);
    expect(result.hadConfidentWavelengthParse).toBe(false);
  });

  it("rejects files when the differentiating middle has multiple in-range numbers", () => {
    const result = parseStackBandOrderSuggestion([
      "capture-365nm-700nm-A.tif",
      "capture-450nm-840nm-B.tif",
    ]);
    expect(result.hadConfidentWavelengthParse).toBe(false);
  });

  it("returns a parsed wavelength map only when parse was confident", () => {
    const ambiguous = parseStackBandOrderSuggestion([
      "card-365G.tif",
      "card-365N.tif",
    ]);
    expect(ambiguous.parsedWavelengthByFileName.size).toBe(0);
  });

  it("handles the postcard-msi fixture by falling back to alphabetical due to repeated wavelengths", () => {
    const fileNames = [
      "postcards_postcardmsi-Postcard-365G_017_R.tif",
      "postcards_postcardmsi-Postcard-385N_002_R.tif",
      "postcards_postcardmsi-Postcard-365N_023_R.tif",
      "postcards_postcardmsi-Postcard-410I_024_R.tif",
    ];
    const result = parseStackBandOrderSuggestion(fileNames);
    expect(result.hadConfidentWavelengthParse).toBe(false);
    expect(result.suggestedRowOrder[0]).toBe("postcards_postcardmsi-Postcard-365G_017_R.tif");
    expect(result.differentiatingSubstringByFileName.get(
      "postcards_postcardmsi-Postcard-365G_017_R.tif",
    )).toBe("365G_017");
  });

  it("preserves order for the single-file edge case", () => {
    const result = parseStackBandOrderSuggestion(["only-450nm.tif"]);
    expect(result.suggestedRowOrder).toEqual(["only-450nm.tif"]);
  });
});
