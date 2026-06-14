import { copyFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixturePath } from "../fixtures/fixture-manifest";

// Throwaway fixtures the committed set does not provide: wavelength-named single-band
// TIFFs (to exercise the multi-file review modal's auto-suggested wavelength stack) and
// a decode-failing file (to exercise the single-file fast path's non-blocking toast).
// They live under os.tmpdir so they never pollute the committed e2e/fixtures set.

export interface WavelengthStackFixtureFile {
  readonly filePath: string;
  readonly fileName: string;
  readonly wavelength: number;
}

const WAVELENGTH_STACK_NANOMETERS: ReadonlyArray<number> = [450, 550, 650];

export async function writeTemporaryWavelengthStackTiffFixtures(): Promise<
  ReadonlyArray<WavelengthStackFixtureFile>
> {
  const directory = await mkdtemp(join(tmpdir(), "msi-e2e-stack-"));
  return Promise.all(
    WAVELENGTH_STACK_NANOMETERS.map((wavelength) =>
      copySingleBandTiffUnderWavelengthName(directory, wavelength),
    ),
  );
}

async function copySingleBandTiffUnderWavelengthName(
  directory: string,
  wavelength: number,
): Promise<WavelengthStackFixtureFile> {
  const fileName = `capture_w${wavelength}.tif`;
  const filePath = join(directory, fileName);
  await copyFile(fixturePath("flat-field-reference.tif"), filePath);
  return { filePath, fileName, wavelength };
}

export async function writeTemporaryCorruptImageFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "msi-e2e-corrupt-"));
  const filePath = join(directory, "corrupt.tif");
  await writeFile(filePath, Buffer.from("this is not a valid tiff file", "utf8"));
  return filePath;
}
