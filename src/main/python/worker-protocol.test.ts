import { describe, expect, it } from "vitest";

import {
  encodeRawBinaryFrame,
  encodeWorkerRequestFrame,
  MalformedWorkerResponseError,
  WorkerResponseFrameDecoder,
  type PythonWorkerResponse,
} from "./worker-protocol";

function encodeResponseFrame(response: PythonWorkerResponse): Buffer {
  const payload = Buffer.from(JSON.stringify(response), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

describe("encodeWorkerRequestFrame", () => {
  it("prefixes the UTF-8 JSON payload with its little-endian byte length", () => {
    const frame = encodeWorkerRequestFrame({
      type: "run-user-script",
      input: { kind: "script", scriptSource: "def run(): return 1" },
      cube: null,
      resultKind: "value",
      sandbox: true,
    });
    const payload = frame.subarray(4);
    expect(frame.readUInt32LE(0)).toBe(payload.length);
    expect(JSON.parse(payload.toString("utf8"))).toEqual({
      type: "run-user-script",
      input: { kind: "script", scriptSource: "def run(): return 1" },
      cube: null,
      resultKind: "value",
      sandbox: true,
    });
  });

  it("measures multi-byte characters in bytes, not code units", () => {
    const frame = encodeWorkerRequestFrame({
      type: "run-user-script",
      input: { kind: "formula", expression: "# λ = 550nm" },
      cube: null,
      resultKind: "cube",
      sandbox: true,
    });
    expect(frame.readUInt32LE(0)).toBe(frame.length - 4);
  });
});

describe("encodeRawBinaryFrame", () => {
  it("length-prefixes a raw payload so it decodes like any other frame", () => {
    const payload = Buffer.from([1, 2, 3, 4, 5]);
    const frame = encodeRawBinaryFrame(payload);
    expect(frame.readUInt32LE(0)).toBe(payload.length);
    expect(frame.subarray(4)).toEqual(payload);
  });
});

describe("WorkerResponseFrameDecoder", () => {
  it("decodes a complete script-result frame", () => {
    const decoder = new WorkerResponseFrameDecoder();
    const responses = decoder.appendChunkAndTakeCompletedResponses(
      encodeResponseFrame({ type: "script-result", value: 42 }),
    );
    expect(responses).toEqual([{ type: "script-result", value: 42 }]);
  });

  it("reassembles a frame delivered one byte at a time", () => {
    const decoder = new WorkerResponseFrameDecoder();
    const frame = encodeResponseFrame({ type: "script-error", message: "boom", traceback: "tb" });
    const responses: PythonWorkerResponse[] = [];
    for (const byte of frame) {
      responses.push(...decoder.appendChunkAndTakeCompletedResponses(Buffer.from([byte])));
    }
    expect(responses).toEqual([{ type: "script-error", message: "boom", traceback: "tb" }]);
  });

  it("decodes two frames arriving in a single chunk", () => {
    const decoder = new WorkerResponseFrameDecoder();
    const chunk = Buffer.concat([
      encodeResponseFrame({ type: "script-result", value: [1, 2] }),
      encodeResponseFrame({ type: "script-result", value: "done" }),
    ]);
    expect(decoder.appendChunkAndTakeCompletedResponses(chunk)).toEqual([
      { type: "script-result", value: [1, 2] },
      { type: "script-result", value: "done" },
    ]);
  });

  it("returns nothing while a frame is still incomplete", () => {
    const decoder = new WorkerResponseFrameDecoder();
    const frame = encodeResponseFrame({ type: "script-result", value: null });
    expect(decoder.appendChunkAndTakeCompletedResponses(frame.subarray(0, 6))).toEqual([]);
  });

  it("rejects a payload that is not valid JSON", () => {
    const decoder = new WorkerResponseFrameDecoder();
    const payload = Buffer.from("not json", "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length, 0);
    expect(() =>
      decoder.appendChunkAndTakeCompletedResponses(Buffer.concat([header, payload])),
    ).toThrow(MalformedWorkerResponseError);
  });

  it("rejects a JSON payload that is not a known response message", () => {
    const decoder = new WorkerResponseFrameDecoder();
    const payload = Buffer.from(JSON.stringify({ type: "mystery" }), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length, 0);
    expect(() =>
      decoder.appendChunkAndTakeCompletedResponses(Buffer.concat([header, payload])),
    ).toThrow(MalformedWorkerResponseError);
  });
});

describe("WorkerResponseFrameDecoder cube results", () => {
  function encodeCubeResultFrames(shape: [number, number, number], values: number[]): Buffer {
    const headerFrame = encodeJsonFrame({ type: "completed", cubeShape: shape });
    const floats = Float32Array.from(values);
    return Buffer.concat([headerFrame, encodeRawBinaryFrame(Buffer.from(floats.buffer))]);
  }

  function encodeJsonFrame(message: unknown): Buffer {
    const payload = Buffer.from(JSON.stringify(message), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length, 0);
    return Buffer.concat([header, payload]);
  }

  it("folds a completed header frame plus a raw float32 frame into one cube-result", () => {
    const decoder = new WorkerResponseFrameDecoder();
    const responses = decoder.appendChunkAndTakeCompletedResponses(
      encodeCubeResultFrames([2, 1, 2], [1, 2, 10, 20]),
    );
    expect(responses).toEqual([
      {
        type: "cube-result",
        shape: [2, 1, 2],
        bands: [Float32Array.from([1, 2]), Float32Array.from([10, 20])],
      },
    ]);
  });

  it("emits nothing after the header frame until the raw cube frame completes", () => {
    const decoder = new WorkerResponseFrameDecoder();
    const transmission = encodeCubeResultFrames([1, 2, 2], [1, 2, 3, 4]);
    const headerFrameEnd = 4 + transmission.readUInt32LE(0);
    expect(decoder.appendChunkAndTakeCompletedResponses(transmission.subarray(0, headerFrameEnd + 3))).toEqual([]);
    expect(decoder.appendChunkAndTakeCompletedResponses(transmission.subarray(headerFrameEnd + 3))).toEqual([
      { type: "cube-result", shape: [1, 2, 2], bands: [Float32Array.from([1, 2, 3, 4])] },
    ]);
  });

  it("reassembles a cube-result transmission delivered one byte at a time", () => {
    const decoder = new WorkerResponseFrameDecoder();
    const transmission = encodeCubeResultFrames([2, 1, 1], [7, 9]);
    const responses: PythonWorkerResponse[] = [];
    for (const byte of transmission) {
      responses.push(...decoder.appendChunkAndTakeCompletedResponses(Buffer.from([byte])));
    }
    expect(responses).toEqual([
      { type: "cube-result", shape: [2, 1, 1], bands: [Float32Array.from([7]), Float32Array.from([9])] },
    ]);
  });

  it("still decodes an ordinary JSON response after a cube-result", () => {
    const decoder = new WorkerResponseFrameDecoder();
    const chunk = Buffer.concat([
      encodeCubeResultFrames([1, 1, 1], [5]),
      encodeResponseFrame({ type: "script-result", value: "done" }),
    ]);
    expect(decoder.appendChunkAndTakeCompletedResponses(chunk)).toEqual([
      { type: "cube-result", shape: [1, 1, 1], bands: [Float32Array.from([5])] },
      { type: "script-result", value: "done" },
    ]);
  });

  it("rejects a raw cube frame whose length disagrees with the declared shape", () => {
    const decoder = new WorkerResponseFrameDecoder();
    const headerFrame = encodeJsonFrame({ type: "completed", cubeShape: [2, 2, 2] });
    const undersizedCubeFrame = encodeRawBinaryFrame(Buffer.from(Float32Array.from([1, 2]).buffer));
    expect(() =>
      decoder.appendChunkAndTakeCompletedResponses(Buffer.concat([headerFrame, undersizedCubeFrame])),
    ).toThrow(MalformedWorkerResponseError);
  });

  it("rejects a completed header whose cubeShape is not three non-negative integers", () => {
    const decoder = new WorkerResponseFrameDecoder();
    expect(() =>
      decoder.appendChunkAndTakeCompletedResponses(encodeJsonFrame({ type: "completed", cubeShape: [2, 2] })),
    ).toThrow(MalformedWorkerResponseError);
  });
});
