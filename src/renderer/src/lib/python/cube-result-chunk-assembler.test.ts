import { describe, expect, it } from "vitest";

import { createCubeResultChunkAssembler } from "./cube-result-chunk-assembler";

function bytesOfFloats(values: number[]): Uint8Array {
  return new Uint8Array(Float32Array.from(values).buffer.slice(0));
}

describe("createCubeResultChunkAssembler", () => {
  it("reassembles bands from chunks that split inside and across band boundaries", () => {
    const assembler = createCubeResultChunkAssembler([2, 1, 3], 24);
    const allBytes = bytesOfFloats([1, 2, 3, 10, 20, 30]);
    assembler.append(allBytes.subarray(0, 5));
    assembler.append(allBytes.subarray(5, 14));
    assembler.append(allBytes.subarray(14));
    const bands = assembler.finish();
    expect(bands).toHaveLength(2);
    expect(Array.from(bands[0]!)).toEqual([1, 2, 3]);
    expect(Array.from(bands[1]!)).toEqual([10, 20, 30]);
  });

  it("rejects a byte count that does not match the shape", () => {
    expect(() => createCubeResultChunkAssembler([2, 1, 3], 23)).toThrow(/did not match its stack shape/);
  });

  it("rejects an invalid shape", () => {
    expect(() => createCubeResultChunkAssembler([0, 1, 3], 0)).toThrow(/invalid stack shape/);
    expect(() => createCubeResultChunkAssembler([1, 1.5, 2], 12)).toThrow(/invalid stack shape/);
  });

  it("rejects more bytes than the shape describes", () => {
    const assembler = createCubeResultChunkAssembler([1, 1, 1], 4);
    assembler.append(bytesOfFloats([7]));
    expect(() => assembler.append(bytesOfFloats([8]))).toThrow(/more bytes/);
  });

  it("rejects finishing before every byte arrived", () => {
    const assembler = createCubeResultChunkAssembler([1, 1, 2], 8);
    assembler.append(bytesOfFloats([7]));
    expect(() => assembler.finish()).toThrow(/ended before every stack byte/);
  });
});
