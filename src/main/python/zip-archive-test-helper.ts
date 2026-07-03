// Test-only helper that writes a .zip archive from a map of entry-name -> UTF-8 content,
// so import tests can build a multi-module tool without committing a binary fixture. Not
// referenced by any production code, so it never enters the app bundle.
import { createWriteStream } from "node:fs";
import yazl from "yazl";

export function writeZipArchiveWithEntries(
  zipPath: string,
  entriesByName: Record<string, string>,
): Promise<void> {
  const archive = new yazl.ZipFile();
  for (const [entryName, content] of Object.entries(entriesByName)) {
    archive.addBuffer(Buffer.from(content, "utf8"), entryName);
  }
  archive.end();
  return streamArchiveOutputToFile(archive, zipPath);
}

function streamArchiveOutputToFile(archive: yazl.ZipFile, zipPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    output.on("close", resolve);
    output.on("error", reject);
    archive.outputStream.pipe(output);
  });
}
