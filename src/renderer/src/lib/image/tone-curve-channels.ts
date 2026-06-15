import type { ToneCurveAnchor } from "@/lib/image/apply-tone-curve";
import {
  buildDefaultToneCurveAnchors,
  toneCurveAnchorsMatchDefaultIdentity,
  type ToneCurveValueRanges,
} from "@/lib/image/tone-curve-editor-state";

/**
 * CT-175: per-channel tone-curve state for true-colour composites. While a
 * scientific stack keeps the single-curve-targets-selected-band model, a photo
 * shown as an RGB composite gets an independent curve for the combined "rgb"
 * (Value) channel and for each of red/green/blue. Every channel is identity by
 * default: a channel with no stored anchors reads back as the default diagonal.
 * These are pure data transforms so the UI (CT-176) and Apply (CT-178) can reuse
 * them without owning the logic.
 */
export type ToneCurveChannel = "rgb" | "red" | "green" | "blue";

export const TONE_CURVE_CHANNELS: ReadonlyArray<ToneCurveChannel> = ["rgb", "red", "green", "blue"];

export const DEFAULT_TONE_CURVE_CHANNEL: ToneCurveChannel = "rgb";

export type ToneCurveChannelAnchors = Readonly<
  Partial<Record<ToneCurveChannel, ReadonlyArray<ToneCurveAnchor>>>
>;

export type ToneCurveEditingMode = "channels" | "single-band";

export function toneCurveEditingModeForComposite(isRgbComposite: boolean): ToneCurveEditingMode {
  return isRgbComposite ? "channels" : "single-band";
}

export function colorBandIndexForToneCurveChannel(channel: ToneCurveChannel): number | null {
  if (channel === "red") return 0;
  if (channel === "green") return 1;
  if (channel === "blue") return 2;
  return null;
}

export function getToneCurveChannelAnchorsOrDefault(
  channelAnchors: ToneCurveChannelAnchors,
  channel: ToneCurveChannel,
  ranges: ToneCurveValueRanges,
): ReadonlyArray<ToneCurveAnchor> {
  const stored = channelAnchors[channel];
  if (stored && stored.length >= 2) return stored;
  return buildDefaultToneCurveAnchors(ranges);
}

export function setToneCurveChannelAnchors(
  channelAnchors: ToneCurveChannelAnchors,
  channel: ToneCurveChannel,
  anchors: ReadonlyArray<ToneCurveAnchor>,
): ToneCurveChannelAnchors {
  return { ...channelAnchors, [channel]: anchors };
}

export function resetToneCurveChannel(
  channelAnchors: ToneCurveChannelAnchors,
  channel: ToneCurveChannel,
): ToneCurveChannelAnchors {
  return Object.fromEntries(
    Object.entries(channelAnchors).filter(([key]) => key !== channel),
  ) as ToneCurveChannelAnchors;
}

export function resetAllToneCurveChannels(): ToneCurveChannelAnchors {
  return {};
}

export function listNonIdentityToneCurveChannels(
  channelAnchors: ToneCurveChannelAnchors,
  ranges: ToneCurveValueRanges,
): ReadonlyArray<ToneCurveChannel> {
  return TONE_CURVE_CHANNELS.filter((channel) =>
    channelHoldsNonIdentityCurve(channelAnchors, channel, ranges),
  );
}

function channelHoldsNonIdentityCurve(
  channelAnchors: ToneCurveChannelAnchors,
  channel: ToneCurveChannel,
  ranges: ToneCurveValueRanges,
): boolean {
  const stored = channelAnchors[channel];
  if (!stored || stored.length < 2) return false;
  return !toneCurveAnchorsMatchDefaultIdentity(stored, ranges);
}
