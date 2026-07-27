import { describe, expect, it } from "vitest";
import { SCRIPTING_DOCS_URL } from "./scripting-docs-url";

// CT-218: the hosted scripting guide is the ONE documentation surface; every
// in-app link funnels through this URL, so pin where it points.
describe("SCRIPTING_DOCS_URL", () => {
  it("points at the in-scope/ciag-toolbox repository", () => {
    expect(SCRIPTING_DOCS_URL).toContain("github.com/in-scope/ciag-toolbox");
  });

  it("ends at docs/python-scripting.md", () => {
    expect(SCRIPTING_DOCS_URL.endsWith("docs/python-scripting.md")).toBe(true);
  });

  it("is served over https", () => {
    expect(SCRIPTING_DOCS_URL.startsWith("https://")).toBe(true);
  });
});
