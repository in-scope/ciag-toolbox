import { describe, expect, it } from "vitest";

import {
  buildRopExecuteParams,
  drawRopSeed,
  readForcedRopSeedFromE2eBridgeOrNull,
  ROP_SEED_EXCLUSIVE_UPPER_BOUND,
} from "./rop-run-request";

describe("drawRopSeed", () => {
  it("returns the forced seed when one is set", () => {
    expect(drawRopSeed(20260822, () => 0.5)).toBe(20260822);
    expect(drawRopSeed(0, () => 0.5)).toBe(0);
  });

  it("draws a whole seed below 2^32 otherwise", () => {
    expect(drawRopSeed(null, () => 0)).toBe(0);
    expect(drawRopSeed(null, () => 0.5)).toBe(ROP_SEED_EXCLUSIVE_UPPER_BOUND / 2);
    expect(drawRopSeed(null, () => 0.999999999)).toBeLessThan(ROP_SEED_EXCLUSIVE_UPPER_BOUND);
    expect(Number.isInteger(drawRopSeed(null, () => 0.123456789))).toBe(true);
  });
});

describe("buildRopExecuteParams", () => {
  it("passes the seed and a single-candidate count", () => {
    expect(buildRopExecuteParams(7)).toEqual({ seed: 7, count: 1 });
  });
});

describe("readForcedRopSeedFromE2eBridgeOrNull", () => {
  it("reads a whole seed from the e2e bridge", () => {
    expect(
      readForcedRopSeedFromE2eBridgeOrNull({ toolboxE2E: { ropForcedSeedOverride: 42 } }),
    ).toBe(42);
  });

  it("returns null without the bridge, without the override, or for junk", () => {
    expect(readForcedRopSeedFromE2eBridgeOrNull(undefined)).toBeNull();
    expect(readForcedRopSeedFromE2eBridgeOrNull({})).toBeNull();
    expect(readForcedRopSeedFromE2eBridgeOrNull({ toolboxE2E: {} })).toBeNull();
    expect(
      readForcedRopSeedFromE2eBridgeOrNull({ toolboxE2E: { ropForcedSeedOverride: null } }),
    ).toBeNull();
    expect(
      readForcedRopSeedFromE2eBridgeOrNull({ toolboxE2E: { ropForcedSeedOverride: 1.5 } }),
    ).toBeNull();
  });
});
