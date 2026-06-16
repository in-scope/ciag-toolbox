import type { ToneCurveAnchor } from "@/lib/image/apply-tone-curve";
import {
  TONE_CURVE_CHANNELS,
  type ToneCurveChannel,
  type ToneCurveChannelAnchors,
} from "@/lib/image/tone-curve-channels";

/**
 * CT-175: the `toneCurveAnchorsJson` apply parameter must carry either a single
 * curve (the legacy scientific-stack case) or a per-channel set of curves (a
 * colour photo). The single case serializes to the SAME bytes as before - an
 * array of [input, output] pairs - so older bundles and the existing apply path
 * keep working. The multi-channel case serializes to a channel-keyed object, so
 * a parser can tell the two apart by whether the JSON root is an array.
 */
export type ToneCurveApplyAnchors =
  | { readonly kind: "single-band"; readonly anchors: ReadonlyArray<ToneCurveAnchor> }
  | { readonly kind: "channels"; readonly channels: ToneCurveChannelAnchors };

type SerializedAnchorPair = readonly [number, number];

export function serializeToneCurveApplyAnchors(value: ToneCurveApplyAnchors): string {
  if (value.kind === "single-band") return JSON.stringify(serializeAnchors(value.anchors));
  return JSON.stringify(serializeChannelAnchors(value.channels));
}

export function parseToneCurveApplyAnchors(json: string): ToneCurveApplyAnchors {
  const parsed = JSON.parse(json) as unknown;
  if (Array.isArray(parsed)) {
    return { kind: "single-band", anchors: deserializeAnchorPairs(parsed as SerializedAnchorPair[]) };
  }
  return { kind: "channels", channels: deserializeChannelAnchors(parsed as Record<string, unknown>) };
}

function serializeAnchors(anchors: ReadonlyArray<ToneCurveAnchor>): SerializedAnchorPair[] {
  return anchors.map((anchor) => [anchor.input, anchor.output]);
}

function serializeChannelAnchors(
  channels: ToneCurveChannelAnchors,
): Record<string, SerializedAnchorPair[]> {
  const result: Record<string, SerializedAnchorPair[]> = {};
  for (const channel of TONE_CURVE_CHANNELS) {
    const anchors = channels[channel];
    if (anchors) result[channel] = serializeAnchors(anchors);
  }
  return result;
}

function deserializeAnchorPairs(pairs: ReadonlyArray<SerializedAnchorPair>): ToneCurveAnchor[] {
  return pairs.map(([input, output]) => ({ input, output }));
}

function deserializeChannelAnchors(raw: Record<string, unknown>): ToneCurveChannelAnchors {
  const result: Partial<Record<ToneCurveChannel, ReadonlyArray<ToneCurveAnchor>>> = {};
  for (const channel of TONE_CURVE_CHANNELS) {
    const pairs = raw[channel];
    if (Array.isArray(pairs)) result[channel] = deserializeAnchorPairs(pairs as SerializedAnchorPair[]);
  }
  return result;
}
