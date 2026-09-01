import yauzl from "yauzl";

// CT-327: an exported mask layer is ONE zip. The spec's oracle is a real zip
// reader (yauzl, in the spec's Node context only - the renderer writes the
// archive itself with no zip library), so a green assertion here means the
// file the user double-clicks really opens.

export async function readZipEntriesByName(
  archivePath: string,
): Promise<ReadonlyMap<string, Buffer>> {
  const zipFile = await openZipFile(archivePath);
  return collectEveryEntry(zipFile);
}

export async function listZipEntryNames(
  archivePath: string,
): Promise<ReadonlyArray<string>> {
  return Array.from((await readZipEntriesByName(archivePath)).keys());
}

function openZipFile(archivePath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile) reject(error ?? new Error(`${archivePath} did not open as a zip.`));
      else resolve(zipFile);
    });
  });
}

function collectEveryEntry(zipFile: yauzl.ZipFile): Promise<ReadonlyMap<string, Buffer>> {
  const entries = new Map<string, Buffer>();
  return new Promise((resolve, reject) => {
    zipFile.on("entry", (entry: yauzl.Entry) => {
      void readOneEntry(zipFile, entry)
        .then((bytes) => entries.set(entry.fileName, bytes))
        .then(() => zipFile.readEntry())
        .catch(reject);
    });
    zipFile.on("end", () => resolve(entries));
    zipFile.on("error", reject);
    zipFile.readEntry();
  });
}

function readOneEntry(zipFile: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) return reject(error ?? new Error(`${entry.fileName} did not open.`));
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  });
}
