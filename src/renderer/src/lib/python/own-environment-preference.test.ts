import { describe, expect, it } from "vitest";

import {
  describePythonEnvironmentStatus,
  isOwnEnvironmentModeActive,
  normalizeOwnInterpreterPathInput,
  shouldSandboxUserScriptInEnvironment,
  type PythonEnvironmentSnapshot,
} from "./own-environment-preference";

const BUNDLED: PythonEnvironmentSnapshot = { ownInterpreterPath: null, pathExists: false };
const OWN_VALID: PythonEnvironmentSnapshot = {
  ownInterpreterPath: "C:/venv/python.exe",
  pathExists: true,
};
const OWN_MISSING: PythonEnvironmentSnapshot = {
  ownInterpreterPath: "C:/venv/python.exe",
  pathExists: false,
};

describe("normalizeOwnInterpreterPathInput", () => {
  it("trims a real path and treats blank input as no configured path", () => {
    expect(normalizeOwnInterpreterPathInput("  C:/venv/python.exe  ")).toBe(
      "C:/venv/python.exe",
    );
    expect(normalizeOwnInterpreterPathInput("   ")).toBeNull();
    expect(normalizeOwnInterpreterPathInput("")).toBeNull();
  });
});

describe("isOwnEnvironmentModeActive", () => {
  it("is active only when an own interpreter path is configured", () => {
    expect(isOwnEnvironmentModeActive(BUNDLED)).toBe(false);
    expect(isOwnEnvironmentModeActive(OWN_VALID)).toBe(true);
    expect(isOwnEnvironmentModeActive(OWN_MISSING)).toBe(true);
  });
});

describe("shouldSandboxUserScriptInEnvironment", () => {
  it("sandboxes bundled mode and leaves own-environment mode unsandboxed", () => {
    expect(shouldSandboxUserScriptInEnvironment(BUNDLED)).toBe(true);
    expect(shouldSandboxUserScriptInEnvironment(OWN_VALID)).toBe(false);
    expect(shouldSandboxUserScriptInEnvironment(OWN_MISSING)).toBe(false);
  });
});

describe("describePythonEnvironmentStatus", () => {
  it("classifies bundled, valid own, and missing own paths", () => {
    expect(describePythonEnvironmentStatus(BUNDLED)).toEqual({ mode: "bundled" });
    expect(describePythonEnvironmentStatus(OWN_VALID)).toEqual({
      mode: "own-valid",
      interpreterPath: "C:/venv/python.exe",
    });
    expect(describePythonEnvironmentStatus(OWN_MISSING)).toEqual({
      mode: "own-missing",
      interpreterPath: "C:/venv/python.exe",
    });
  });
});
