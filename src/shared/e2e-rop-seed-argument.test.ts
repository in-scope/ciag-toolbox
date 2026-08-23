import { describe, expect, it } from "vitest";

import {
  buildRopSeedPreloadArgumentOrNull,
  readRopSeedOverrideFromArguments,
} from "./e2e-rop-seed-argument";

describe("buildRopSeedPreloadArgumentOrNull", () => {
  it("builds the preload argument for a whole seed", () => {
    expect(buildRopSeedPreloadArgumentOrNull("20260822")).toBe(
      "--msi-e2e-rop-forced-seed=20260822",
    );
  });

  it("accepts zero as a seed", () => {
    expect(buildRopSeedPreloadArgumentOrNull("0")).toBe("--msi-e2e-rop-forced-seed=0");
  });

  it("returns null for an absent, negative, fractional, or non-numeric value", () => {
    expect(buildRopSeedPreloadArgumentOrNull(undefined)).toBeNull();
    expect(buildRopSeedPreloadArgumentOrNull("-1")).toBeNull();
    expect(buildRopSeedPreloadArgumentOrNull("1.5")).toBeNull();
    expect(buildRopSeedPreloadArgumentOrNull("seed")).toBeNull();
  });
});

describe("readRopSeedOverrideFromArguments", () => {
  it("reads the seed back out of the argument list", () => {
    expect(
      readRopSeedOverrideFromArguments(["--other", "--msi-e2e-rop-forced-seed=20260822"]),
    ).toBe(20260822);
  });

  it("returns null when no seed argument is present or it is malformed", () => {
    expect(readRopSeedOverrideFromArguments(["--other"])).toBeNull();
    expect(readRopSeedOverrideFromArguments(["--msi-e2e-rop-forced-seed=nope"])).toBeNull();
  });
});
