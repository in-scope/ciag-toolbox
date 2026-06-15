import { describe, expect, it } from "vitest";

import { buildDefaultToneCurveAnchors, type ToneCurveValueRanges } from "@/lib/image/tone-curve-editor-state";
import {
  colorBandIndexForToneCurveChannel,
  DEFAULT_TONE_CURVE_CHANNEL,
  getToneCurveChannelAnchorsOrDefault,
  listNonIdentityToneCurveChannels,
  resetAllToneCurveChannels,
  resetToneCurveChannel,
  setToneCurveChannelAnchors,
  toneCurveEditingModeForComposite,
  TONE_CURVE_CHANNELS,
  type ToneCurveChannelAnchors,
} from "@/lib/image/tone-curve-channels";

const RANGES: ToneCurveValueRanges = { inputMin: 0, inputMax: 255, outputMin: 0, outputMax: 255 };

const RED_CURVE = [
  { input: 0, output: 0 },
  { input: 128, output: 200 },
  { input: 255, output: 255 },
];

describe("channel constants", () => {
  it("defaults the active channel to rgb and lists exactly rgb/red/green/blue", () => {
    expect(DEFAULT_TONE_CURVE_CHANNEL).toBe("rgb");
    expect(TONE_CURVE_CHANNELS).toEqual(["rgb", "red", "green", "blue"]);
  });
});

describe("toneCurveEditingModeForComposite", () => {
  it("uses per-channel editing only for an rgb composite", () => {
    expect(toneCurveEditingModeForComposite(true)).toBe("channels");
    expect(toneCurveEditingModeForComposite(false)).toBe("single-band");
  });
});

describe("colorBandIndexForToneCurveChannel", () => {
  it("maps red/green/blue to bands 0/1/2 and rgb to no single band", () => {
    expect(colorBandIndexForToneCurveChannel("red")).toBe(0);
    expect(colorBandIndexForToneCurveChannel("green")).toBe(1);
    expect(colorBandIndexForToneCurveChannel("blue")).toBe(2);
    expect(colorBandIndexForToneCurveChannel("rgb")).toBeNull();
  });
});

describe("getToneCurveChannelAnchorsOrDefault", () => {
  it("returns the identity diagonal for a channel with no stored anchors", () => {
    expect(getToneCurveChannelAnchorsOrDefault({}, "red", RANGES)).toEqual(
      buildDefaultToneCurveAnchors(RANGES),
    );
  });

  it("returns the stored anchors when a channel has at least two", () => {
    const channels: ToneCurveChannelAnchors = { red: RED_CURVE };
    expect(getToneCurveChannelAnchorsOrDefault(channels, "red", RANGES)).toBe(RED_CURVE);
  });
});

describe("setToneCurveChannelAnchors", () => {
  it("stores a channel's anchors without mutating the input or other channels", () => {
    const before: ToneCurveChannelAnchors = { green: RED_CURVE };
    const after = setToneCurveChannelAnchors(before, "red", RED_CURVE);
    expect(after).toEqual({ green: RED_CURVE, red: RED_CURVE });
    expect(before).toEqual({ green: RED_CURVE });
  });
});

describe("resetToneCurveChannel", () => {
  it("drops only the named channel back to identity", () => {
    const before: ToneCurveChannelAnchors = { red: RED_CURVE, blue: RED_CURVE };
    const after = resetToneCurveChannel(before, "red");
    expect(after).toEqual({ blue: RED_CURVE });
    expect(before).toEqual({ red: RED_CURVE, blue: RED_CURVE });
  });
});

describe("resetAllToneCurveChannels", () => {
  it("clears every channel back to identity", () => {
    expect(resetAllToneCurveChannels()).toEqual({});
  });
});

describe("listNonIdentityToneCurveChannels", () => {
  it("lists only channels whose stored curve differs from identity, in channel order", () => {
    const channels: ToneCurveChannelAnchors = {
      blue: RED_CURVE,
      red: RED_CURVE,
      green: buildDefaultToneCurveAnchors(RANGES),
    };
    expect(listNonIdentityToneCurveChannels(channels, RANGES)).toEqual(["red", "blue"]);
  });

  it("returns nothing when no channel has been edited", () => {
    expect(listNonIdentityToneCurveChannels({}, RANGES)).toEqual([]);
  });
});
