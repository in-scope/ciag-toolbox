import { describe, expect, it } from "vitest";

import {
  describeSliderTrackForSchema,
  logSymmetricValueToSliderPosition,
  sliderPositionToLogSymmetricValue,
} from "./log-symmetric-slider-scale";
import type { SliderParameterSchema } from "./parameter-schema";

const CONTRAST_MAXIMUM = 20;

const LOG_SYMMETRIC_SCHEMA: SliderParameterSchema = {
  kind: "slider",
  id: "contrastRatio",
  label: "Contrast",
  defaultValue: 1,
  min: 0.05,
  max: 20,
  step: 0.005,
  scale: "log-symmetric",
};

const LINEAR_SCHEMA: SliderParameterSchema = {
  kind: "slider",
  id: "brightnessPercent",
  label: "Brightness",
  defaultValue: 0,
  min: -100,
  max: 100,
  step: 1,
};

describe("sliderPositionToLogSymmetricValue", () => {
  it("maps the three anchor positions to 0.05, exactly 1, and 20", () => {
    expect(sliderPositionToLogSymmetricValue(0, CONTRAST_MAXIMUM)).toBeCloseTo(0.05, 12);
    expect(sliderPositionToLogSymmetricValue(0.5, CONTRAST_MAXIMUM)).toBe(1);
    expect(sliderPositionToLogSymmetricValue(1, CONTRAST_MAXIMUM)).toBe(20);
  });

  it("round-trips position -> value -> position within 1e-9", () => {
    for (const position of [0, 0.1, 0.25, 0.5, 0.615, 0.9, 1]) {
      const value = sliderPositionToLogSymmetricValue(position, CONTRAST_MAXIMUM);
      const roundTripped = logSymmetricValueToSliderPosition(value, CONTRAST_MAXIMUM);
      expect(Math.abs(roundTripped - position)).toBeLessThan(1e-9);
    }
  });

  it("round-trips value -> position -> value within 1e-9", () => {
    for (const value of [0.05, 0.2, 1, 1.2, 2, 20]) {
      const position = logSymmetricValueToSliderPosition(value, CONTRAST_MAXIMUM);
      const roundTripped = sliderPositionToLogSymmetricValue(position, CONTRAST_MAXIMUM);
      expect(Math.abs(roundTripped - value)).toBeLessThan(1e-9);
    }
  });
});

describe("describeSliderTrackForSchema", () => {
  it("runs a log-symmetric track over positions 0..1 with the schema step as the position step", () => {
    const track = describeSliderTrackForSchema(LOG_SYMMETRIC_SCHEMA, 1);
    expect(track.trackMin).toBe(0);
    expect(track.trackMax).toBe(1);
    expect(track.trackStep).toBe(0.005);
    expect(track.thumbPosition).toBe(0.5);
  });

  it("snaps committed log-symmetric values to two decimals so display and apply agree", () => {
    const track = describeSliderTrackForSchema(LOG_SYMMETRIC_SCHEMA, 1);
    expect(track.valueAtThumbPosition(0)).toBe(0.05);
    expect(track.valueAtThumbPosition(0.53)).toBe(1.2);
    expect(track.valueAtThumbPosition(1)).toBe(20);
  });

  it("places the thumb of a stored log-symmetric value back at its position", () => {
    const track = describeSliderTrackForSchema(LOG_SYMMETRIC_SCHEMA, 20);
    expect(track.thumbPosition).toBe(1);
  });

  it("ignores the flag for a linear schema: the track IS the value range", () => {
    const track = describeSliderTrackForSchema(LINEAR_SCHEMA, 40);
    expect(track.trackMin).toBe(-100);
    expect(track.trackMax).toBe(100);
    expect(track.trackStep).toBe(1);
    expect(track.thumbPosition).toBe(40);
    expect(track.valueAtThumbPosition(7)).toBe(7);
  });
});
