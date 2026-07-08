import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  USER_SCRIPT_CUBE_WALL_CLOCK_TIMEOUT_MS,
  USER_SCRIPT_WALL_CLOCK_TIMEOUT_MS,
} from "./user-script-timeouts";

// CT-217: successor to script-docs-content.test.ts. The scripting guide now
// lives as a committed markdown file at docs/python-scripting.md (linked from
// the app); this test pins that every required topic and template link
// survives future edits.

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const DOCS_DIRECTORY = join(REPOSITORY_ROOT, "docs");

const TEMPLATE_RELATIVE_PATHS = [
  "examples/weighting-template.py",
  "examples/selection-template.py",
  "examples/transform-template.py",
  "examples/zip-tool-template/main.py",
  "examples/zip-tool-template/helpers.py",
] as const;

function readHostedScriptingDoc(): string {
  return readFileSync(join(DOCS_DIRECTORY, "python-scripting.md"), "utf-8");
}

function readHostedScriptingDocLowercased(): string {
  return readHostedScriptingDoc().toLowerCase();
}

function readTemplateSource(relativePath: string): string {
  return readFileSync(join(DOCS_DIRECTORY, relativePath), "utf-8");
}

describe("hosted scripting doc (docs/python-scripting.md)", () => {
  it("documents both input forms: the inline formula and imported .py/.zip tools", () => {
    const text = readHostedScriptingDocLowercased();
    expect(text).toContain("inline formula");
    expect(text).toContain(".py");
    expect(text).toContain(".zip");
  });

  it("documents the run(cube, wavelengths=None) contract", () => {
    expect(readHostedScriptingDocLowercased()).toContain("run(cube, wavelengths=none)");
  });

  it("documents the cube shape as (bands, height, width)", () => {
    expect(readHostedScriptingDocLowercased()).toContain("(bands, height, width)");
  });

  it("documents all three return contracts", () => {
    const text = readHostedScriptingDocLowercased();
    expect(text).toContain("n-length weight vector");
    expect(text).toContain("height-by-width band");
    expect(text).toContain("(n, height, width)");
    expect(text).toContain("height and width must match the source stack");
  });

  it("documents the bundled package list, with pandas called out as absent", () => {
    const text = readHostedScriptingDocLowercased();
    expect(text).toContain("numpy, scipy, and scikit-image");
    expect(text).toContain("pandas is not bundled");
  });

  it("documents the required top-level main.py entry for .zip tools", () => {
    expect(readHostedScriptingDocLowercased()).toContain("top-level `main.py`");
  });

  it("documents the sandbox limits", () => {
    const text = readHostedScriptingDocLowercased();
    expect(text).toContain("sandbox");
    expect(text).toContain("no filesystem or network access");
    expect(text).toContain("import allowlist");
    expect(text).toContain("wall-clock");
    expect(text).toContain("memory bound");
  });

  it("documents wall-clock limits matching the timeout policy module", () => {
    const text = readHostedScriptingDoc();
    const valueSeconds = USER_SCRIPT_WALL_CLOCK_TIMEOUT_MS / 1000;
    const cubeSeconds = USER_SCRIPT_CUBE_WALL_CLOCK_TIMEOUT_MS / 1000;
    expect(text).toContain(`Band weighting and band selection runs: ${valueSeconds} seconds.`);
    expect(text).toContain(`Custom transform (cube) runs: ${cubeSeconds} seconds.`);
  });

  it("documents the own-environment opt-in as trusted, unsandboxed, no installs", () => {
    const text = readHostedScriptingDocLowercased();
    expect(text).toContain("own python environment");
    expect(text).toContain("unsandboxed");
    expect(text).toContain("never installs packages");
  });

  it("provides a worked example for each input form", () => {
    const text = readHostedScriptingDoc();
    expect(text).toContain("cube.var(axis=(1, 2))");
    expect(text).toContain("def run(cube, wavelengths=None):");
  });

  it("links every template file", () => {
    const text = readHostedScriptingDoc();
    for (const relativePath of TEMPLATE_RELATIVE_PATHS) {
      expect(text).toContain(`(${relativePath})`);
    }
  });

  it("ships every linked template on disk", () => {
    for (const relativePath of TEMPLATE_RELATIVE_PATHS) {
      expect(existsSync(join(DOCS_DIRECTORY, relativePath))).toBe(true);
    }
  });
});

describe("hosted scripting templates (docs/examples/)", () => {
  it("defines the run(cube, wavelengths=None) entry in every standalone template", () => {
    for (const relativePath of TEMPLATE_RELATIVE_PATHS) {
      if (relativePath.endsWith("helpers.py")) continue;
      expect(readTemplateSource(relativePath)).toContain("def run(cube, wavelengths=None):");
    }
  });

  it("has main.py import the sibling helpers module in the .zip template", () => {
    const mainSource = readTemplateSource("examples/zip-tool-template/main.py");
    expect(mainSource).toContain("from helpers import");
  });
});

describe("hosted scripting doc vocabulary", () => {
  it("uses the locked vocabulary: stack, panel, band", () => {
    const text = readHostedScriptingDocLowercased();
    expect(text).toContain("stack");
    expect(text).toContain("panel");
    expect(text).toContain("band");
  });

  it("never says 'viewport' or calls a stack an 'image'", () => {
    const text = readHostedScriptingDocLowercased();
    expect(text).not.toContain("viewport");
    expect(text).not.toContain(" image");
  });

  it("contains no em dashes in the doc or the templates", () => {
    const sources = [
      readHostedScriptingDoc(),
      ...TEMPLATE_RELATIVE_PATHS.map(readTemplateSource),
    ];
    for (const source of sources) {
      expect(source).not.toMatch(/[–—]/);
    }
  });
});
