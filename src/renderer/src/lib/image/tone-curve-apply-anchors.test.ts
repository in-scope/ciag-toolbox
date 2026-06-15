import { describe, expect, it } from "vitest";

import {
  parseToneCurveApplyAnchors,
  serializeToneCurveApplyAnchors,
  type ToneCurveApplyAnchors,
} from "@/lib/image/tone-curve-apply-anchors";
import type { ToneCurveChannelAnchors } from "@/lib/image/tone-curve-channels";

const SINGLE_BAND: ToneCurveApplyAnchors = {
  kind: "single-band",
  anchors: [
    { input: 0, output: 0 },
    { input: 128, output: 255 },
  ],
};

const CHANNELS_VALUE: ToneCurveChannelAnchors = {
  rgb: [
    { input: 0, output: 0 },
    { input: 255, output: 255 },
  ],
  red: [
    { input: 0, output: 0 },
    { input: 128, output: 200 },
    { input: 255, output: 255 },
  ],
};

describe("serializeToneCurveApplyAnchors (single-band)", () => {
  it("serializes to the legacy array-of-pairs bytes for backward compatibility", () => {
    expect(serializeToneCurveApplyAnchors(SINGLE_BAND)).toBe("[[0,0],[128,255]]");
  });
});

describe("parseToneCurveApplyAnchors (single-band)", () => {
  it("reads the legacy array-of-pairs format as a single-band curve", () => {
    expect(parseToneCurveApplyAnchors("[[0,0],[128,255]]")).toEqual(SINGLE_BAND);
  });
});

describe("toneCurveApplyAnchors round-trip", () => {
  it("round-trips the backward-compatible single-curve case", () => {
    const json = serializeToneCurveApplyAnchors(SINGLE_BAND);
    expect(parseToneCurveApplyAnchors(json)).toEqual(SINGLE_BAND);
  });

  it("round-trips the multi-channel case keeping each channel's curve", () => {
    const value: ToneCurveApplyAnchors = { kind: "channels", channels: CHANNELS_VALUE };
    const json = serializeToneCurveApplyAnchors(value);
    expect(parseToneCurveApplyAnchors(json)).toEqual(value);
  });

  it("serializes the multi-channel case to a channel-keyed object, not an array", () => {
    const value: ToneCurveApplyAnchors = { kind: "channels", channels: CHANNELS_VALUE };
    const json = serializeToneCurveApplyAnchors(value);
    expect(JSON.parse(json)).toEqual({
      rgb: [[0, 0], [255, 255]],
      red: [[0, 0], [128, 200], [255, 255]],
    });
  });

  it("omits channels that have no stored curve", () => {
    const value: ToneCurveApplyAnchors = { kind: "channels", channels: { red: CHANNELS_VALUE.red } };
    const json = serializeToneCurveApplyAnchors(value);
    expect(Object.keys(JSON.parse(json))).toEqual(["red"]);
  });
});
