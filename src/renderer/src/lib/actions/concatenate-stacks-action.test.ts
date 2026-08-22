import { afterEach, describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";
import {
  forgetAllReferenceRasters,
  rememberReferenceRaster,
} from "@/lib/image/reference-raster-store";
import { buildLoadedPanelReferenceToken } from "@/lib/image/reference-token";

import { CONCATENATE_STACKS_ACTION } from "./concatenate-stacks-action";
import { NO_RASTER_REFERENCE_SELECTED } from "./parameter-schema";

function makeRaster(bandCount: number, fillValue: number): RasterImage {
  return {
    bandPixels: Array.from({ length: bandCount }, () => new Uint16Array([fillValue])),
    width: 1,
    height: 1,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount,
  };
}

describe("CONCATENATE_STACKS_ACTION", () => {
  afterEach(() => {
    forgetAllReferenceRasters();
  });

  it("throws when no second stack is chosen", () => {
    const active = { kind: "raster" as const, raster: makeRaster(1, 10) };
    expect(() =>
      CONCATENATE_STACKS_ACTION.transformSource!(active, { secondStackToken: NO_RASTER_REFERENCE_SELECTED }),
    ).toThrow(/Choose a second stack/);
  });

  it("throws when the chosen second stack is no longer loaded", () => {
    const active = { kind: "raster" as const, raster: makeRaster(1, 10) };
    expect(() =>
      CONCATENATE_STACKS_ACTION.transformSource!(active, { secondStackToken: "panel::Panel 2 (gone.tif)" }),
    ).toThrow(/no longer loaded/);
  });

  it("concatenates the active stack with the resolved second stack", () => {
    const token = buildLoadedPanelReferenceToken(2, "ir.tif");
    rememberReferenceRaster(token, makeRaster(1, 20));
    const active = { kind: "raster" as const, raster: makeRaster(1, 10) };
    const result = CONCATENATE_STACKS_ACTION.transformSource!(active, { secondStackToken: token });
    expect(result.kind).toBe("raster");
    const raster = (result as { raster: RasterImage }).raster;
    expect(raster.bandCount).toBe(2);
    expect(raster.bandPixels[0]?.[0]).toBe(10);
    expect(raster.bandPixels[1]?.[0]).toBe(20);
  });

  it("names the second stack in the History applied label", () => {
    const token = buildLoadedPanelReferenceToken(2, "ir.tif");
    const label = CONCATENATE_STACKS_ACTION.formatAppliedLabel!({ secondStackToken: token });
    expect(label).toBe("Concatenate Stacks (with Panel 2 (ir.tif))");
  });
});
