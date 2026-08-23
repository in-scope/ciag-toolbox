import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const DOCS_DIR = path.join(PROJECT_ROOT, "docs");

function findAllMdFiles(dir: string): string[] {
  const files: string[] = [];

  function walk(currentDir: string) {
    if (!fs.existsSync(currentDir)) {
      return;
    }

    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(fullPath);
      }
    }
  }

  walk(dir);
  return files;
}

describe("docs terminology", () => {
  it("never contains 'MSI Toolbox' in any markdown file", () => {
    const mdFiles = findAllMdFiles(DOCS_DIR);
    expect(mdFiles.length).toBeGreaterThan(0);

    for (const filePath of mdFiles) {
      const content = fs.readFileSync(filePath, "utf-8");
      if (content.includes("MSI Toolbox")) {
        throw new Error(
          `File ${path.relative(PROJECT_ROOT, filePath)} contains 'MSI Toolbox'`
        );
      }
    }
  });
});
