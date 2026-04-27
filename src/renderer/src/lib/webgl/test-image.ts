const TEST_IMAGE_SIZE = 256;
const CHECKER_CELL_SIZE = 32;

export interface TestImageData {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

export function generateBuiltInTestImage(): TestImageData {
  const pixels = new Uint8ClampedArray(TEST_IMAGE_SIZE * TEST_IMAGE_SIZE * 4);
  for (let y = 0; y < TEST_IMAGE_SIZE; y += 1) {
    fillTestImageRow(pixels, y);
  }
  return { width: TEST_IMAGE_SIZE, height: TEST_IMAGE_SIZE, pixels };
}

function fillTestImageRow(pixels: Uint8ClampedArray, y: number): void {
  for (let x = 0; x < TEST_IMAGE_SIZE; x += 1) {
    writeTestImagePixel(pixels, x, y);
  }
}

function writeTestImagePixel(
  pixels: Uint8ClampedArray,
  x: number,
  y: number,
): void {
  const offset = (y * TEST_IMAGE_SIZE + x) * 4;
  const lightCheckerCell = isCheckerCellLight(x, y);
  pixels[offset + 0] = Math.round((x / (TEST_IMAGE_SIZE - 1)) * 255);
  pixels[offset + 1] = Math.round((y / (TEST_IMAGE_SIZE - 1)) * 255);
  pixels[offset + 2] = lightCheckerCell ? 220 : 60;
  pixels[offset + 3] = 255;
}

function isCheckerCellLight(x: number, y: number): boolean {
  const cellX = Math.floor(x / CHECKER_CELL_SIZE);
  const cellY = Math.floor(y / CHECKER_CELL_SIZE);
  return (cellX + cellY) % 2 === 0;
}
