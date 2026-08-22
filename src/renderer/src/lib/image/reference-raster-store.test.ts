import { beforeEach, describe, expect, it } from "vitest";

import type { RasterImage } from "./raster-image";
import {
  forgetAllReferenceRasters,
  listRememberedReferenceRasters,
  readRememberedReferenceRasterOrNull,
  rememberReferenceRaster,
  replaceRememberedPanelReferenceRasters,
} from "./reference-raster-store";
import { buildLoadedPanelReferenceToken } from "./reference-token";

function tinyRaster(): RasterImage {
  return {
    bandPixels: [new Uint16Array(4)],
    width: 2,
    height: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 1,
  };
}

describe("replaceRememberedPanelReferenceRasters", () => {
  beforeEach(() => forgetAllReferenceRasters());

  it("remembers the current panel candidates", () => {
    const token = buildLoadedPanelReferenceToken(1, "a.tif");
    const raster = tinyRaster();
    replaceRememberedPanelReferenceRasters([{ token, raster }]);
    expect(readRememberedReferenceRasterOrNull(token)).toBe(raster);
  });

  it("evicts a closed panel's entry so its cube is collectable (CT-239 leak)", () => {
    const closedToken = buildLoadedPanelReferenceToken(2, "closed.tif");
    replaceRememberedPanelReferenceRasters([{ token: closedToken, raster: tinyRaster() }]);
    replaceRememberedPanelReferenceRasters([]);
    expect(readRememberedReferenceRasterOrNull(closedToken)).toBeNull();
  });

  it("keeps file-path tokens across panel syncs (picked reference files are panel-independent)", () => {
    const filePathToken = "C:/captures/flat-field.tif";
    const fileRaster = tinyRaster();
    rememberReferenceRaster(filePathToken, fileRaster);
    replaceRememberedPanelReferenceRasters([]);
    expect(readRememberedReferenceRasterOrNull(filePathToken)).toBe(fileRaster);
  });

  it("lists every remembered raster (panel and file entries) for the CT-290 release flush", () => {
    const panelRaster = tinyRaster();
    const fileRaster = tinyRaster();
    rememberReferenceRaster("C:/captures/dark-frame.tif", fileRaster);
    replaceRememberedPanelReferenceRasters([
      { token: buildLoadedPanelReferenceToken(1, "a.tif"), raster: panelRaster },
    ]);
    expect(listRememberedReferenceRasters()).toEqual(
      expect.arrayContaining([panelRaster, fileRaster]),
    );
    expect(listRememberedReferenceRasters()).toHaveLength(2);
  });
});
