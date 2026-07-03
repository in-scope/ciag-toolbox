import { describe, expect, it } from "vitest";
import {
  SCRIPT_DOCS_BUNDLED_PACKAGES,
  SCRIPT_DOCS_SECTIONS,
  SCRIPT_DOCS_TITLE,
  type ScriptDocsSection,
} from "./script-docs-content";

function collectAllDocsText(): string {
  const fromSections = SCRIPT_DOCS_SECTIONS.flatMap(collectSectionText);
  return [SCRIPT_DOCS_TITLE, ...fromSections].join("\n").toLowerCase();
}

function collectSectionText(section: ScriptDocsSection): string[] {
  return [
    section.heading,
    ...section.paragraphs,
    ...(section.bullets ?? []),
    section.example?.caption ?? "",
    section.example?.code ?? "",
  ];
}

function findSectionById(id: string): ScriptDocsSection {
  const section = SCRIPT_DOCS_SECTIONS.find((candidate) => candidate.id === id);
  if (!section) throw new Error(`Missing docs section: ${id}`);
  return section;
}

describe("script docs content", () => {
  it("titles the page 'How to write a custom script'", () => {
    expect(SCRIPT_DOCS_TITLE).toBe("How to write a custom script");
  });

  it("documents the run(cube, wavelengths=None) contract", () => {
    expect(collectAllDocsText()).toContain("run(cube, wavelengths=none)");
  });

  it("documents the cube shape as (bands, height, width)", () => {
    expect(collectAllDocsText()).toContain("(bands, height, width)");
  });

  it("documents both custom-input forms", () => {
    const text = collectAllDocsText();
    expect(text).toContain("formula");
    expect(text).toContain(".zip");
    expect(text).toContain(".py");
  });

  it("documents the required top-level main.py entry for .zip tools", () => {
    expect(findSectionById("imported-script").paragraphs.join(" ")).toContain("main.py");
  });

  it("documents both return contracts (band and weight vector)", () => {
    const text = collectAllDocsText();
    expect(text).toContain("height-by-width band");
    expect(text).toContain("n-length weight vector");
  });

  it("lists the bundled package stack", () => {
    expect([...SCRIPT_DOCS_BUNDLED_PACKAGES]).toEqual([
      "numpy",
      "scipy",
      "scikit-image",
    ]);
    expect(collectAllDocsText()).toContain("scikit-image");
  });

  it("documents the own-environment opt-in and the sandbox limits", () => {
    const text = collectAllDocsText();
    expect(text).toContain("python environment");
    expect(text).toContain("sandbox");
    expect(text).toContain("wall-clock");
  });

  it("provides a worked example for the inline formula and the imported script", () => {
    expect(findSectionById("inline-formula").example?.code).toBeTruthy();
    expect(findSectionById("imported-script").example?.code).toContain("def run(");
  });

  it("never calls a stack an 'image' or a panel a 'viewport' in body copy", () => {
    const body = SCRIPT_DOCS_SECTIONS.flatMap((section) => section.paragraphs).join(" ");
    expect(body.toLowerCase()).not.toContain("viewport");
    expect(body.toLowerCase()).not.toContain(" image");
  });
});
