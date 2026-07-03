import { describe, expect, it } from "vitest";

import { encodeCubeAsFloat32Payload } from "./cube-payload";

function readAllFloat32(buffer: Buffer): number[] {
  const values: number[] = [];
  for (let offset = 0; offset < buffer.length; offset += 4) values.push(buffer.readFloatLE(offset));
  return values;
}

describe("encodeCubeAsFloat32Payload", () => {
  const cube = {
    bands: [Float32Array.from([1, 2, 3, 4]), Float32Array.from([10, 20, 30, 40])],
    height: 2,
    width: 2,
    wavelengths: [500, 600],
  };

  it("declares (bands, height, width) float32 shape and the wavelengths in the header", () => {
    expect(encodeCubeAsFloat32Payload(cube).header).toEqual({
      shape: [2, 2, 2],
      dtype: "float32",
      wavelengths: [500, 600],
    });
  });

  it("packs the bands band-major as raw little-endian float32 bytes (no JSON arrays)", () => {
    const { buffer } = encodeCubeAsFloat32Payload(cube);
    expect(buffer.length).toBe(2 * 4 * 4);
    expect(readAllFloat32(buffer)).toEqual([1, 2, 3, 4, 10, 20, 30, 40]);
  });

  it("carries a null wavelengths header when the cube has none", () => {
    const payload = encodeCubeAsFloat32Payload({ ...cube, wavelengths: null });
    expect(payload.header.wavelengths).toBeNull();
  });
});
