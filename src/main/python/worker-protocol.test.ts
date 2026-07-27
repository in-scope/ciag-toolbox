import { describe, expect, it } from "vitest";

import {
  encodeCubeFrameLengthPrefix,
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
      cubeResultSpoolPath: null,
      sandbox: true,
    });
    const payload = frame.subarray(4);
    expect(frame.readUInt32LE(0)).toBe(payload.length);
    expect(JSON.parse(payload.toString("utf8"))).toEqual({
      type: "run-user-script",
      input: { kind: "script", scriptSource: "def run(): return 1" },
      cube: null,
      resultKind: "value",
      cubeResultSpoolPath: null,
      sandbox: true,
    });
  });

  it("measures multi-byte characters in bytes, not code units", () => {
    const frame = encodeWorkerRequestFrame({
      type: "run-user-script",
      input: { kind: "formula", expression: "# λ = 550nm" },
      cube: null,
      resultKind: "cube",
      cubeResultSpoolPath: null,
      sandbox: true,
    });
    expect(frame.readUInt32LE(0)).toBe(frame.length - 4);
  });
});

describe("encodeRawBinaryFrame", () => {
  it("prefixes a raw cube payload with its 8-byte little-endian length", () => {
    const payload = Buffer.from([1, 2, 3, 4, 5]);
    const frame = encodeRawBinaryFrame(payload);
    expect(frame.readBigUInt64LE(0)).toBe(BigInt(payload.length));
    expect(frame.subarray(8)).toEqual(payload);
  });
});

describe("encodeCubeFrameLengthPrefix", () => {
  it("encodes a length past the uint32 cap (the 5 GB scale10 subset cube)", () => {
    const fiveGigabytes = 5_000_000_000;
    expect(encodeCubeFrameLengthPrefix(fiveGigabytes).readBigUInt64LE(0)).toBe(BigInt(fiveGigabytes));
  });

  it("rejects non-integer and negative lengths as harness bugs", () => {
    expect(() => encodeCubeFrameLengthPrefix(-1)).toThrow(/not a valid frame size/);
    expect(() => encodeCubeFrameLengthPrefix(1.5)).toThrow(/not a valid frame size/);
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
  function encodeCompletedCubeFrame(
    shape: [number, number, number],
    spooledByteLength: number,
  ): Buffer {
    return encodeJsonFrame({ type: "completed", cubeShape: shape, spooledByteLength });
  }

  function encodeJsonFrame(message: unknown): Buffer {
    const payload = Buffer.from(JSON.stringify(message), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length, 0);
    return Buffer.concat([header, payload]);
  }

  it("maps a completed message to a cube-result naming shape and spooled size", () => {
    const decoder = new WorkerResponseFrameDecoder();
    const responses = decoder.appendChunkAndTakeCompletedResponses(encodeCompletedCubeFrame([2, 1, 2], 16));
    expect(responses).toEqual([{ type: "cube-result", shape: [2, 1, 2], totalBytes: 16 }]);
  });

  it("reassembles a completed cube message delivered one byte at a time", () => {
    const decoder = new WorkerResponseFrameDecoder();
    const transmission = encodeCompletedCubeFrame([2, 1, 1], 8);
    const responses: PythonWorkerResponse[] = [];
    for (const byte of transmission) {
      responses.push(...decoder.appendChunkAndTakeCompletedResponses(Buffer.from([byte])));
    }
    expect(responses).toEqual([{ type: "cube-result", shape: [2, 1, 1], totalBytes: 8 }]);
  });

  it("still decodes an ordinary JSON response after a cube-result", () => {
    const decoder = new WorkerResponseFrameDecoder();
    const chunk = Buffer.concat([
      encodeCompletedCubeFrame([1, 1, 1], 4),
      encodeResponseFrame({ type: "script-result", value: "done" }),
    ]);
    expect(decoder.appendChunkAndTakeCompletedResponses(chunk)).toEqual([
      { type: "cube-result", shape: [1, 1, 1], totalBytes: 4 },
      { type: "script-result", value: "done" },
    ]);
  });

  it("rejects a spooled byte length that disagrees with the declared shape", () => {
    const decoder = new WorkerResponseFrameDecoder();
    expect(() =>
      decoder.appendChunkAndTakeCompletedResponses(encodeCompletedCubeFrame([2, 2, 2], 8)),
    ).toThrow(MalformedWorkerResponseError);
  });

  it("rejects a completed message whose cubeShape is not three non-negative integers", () => {
    const decoder = new WorkerResponseFrameDecoder();
    expect(() =>
      decoder.appendChunkAndTakeCompletedResponses(
        encodeJsonFrame({ type: "completed", cubeShape: [2, 2], spooledByteLength: 16 }),
      ),
    ).toThrow(MalformedWorkerResponseError);
  });

  it("rejects a completed message without a spooled byte length", () => {
    const decoder = new WorkerResponseFrameDecoder();
    expect(() =>
      decoder.appendChunkAndTakeCompletedResponses(
        encodeJsonFrame({ type: "completed", cubeShape: [1, 1, 1] }),
      ),
    ).toThrow(MalformedWorkerResponseError);
  });
});
