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
      sandbox: true,
    });
    const payload = frame.subarray(4);
    expect(frame.readUInt32LE(0)).toBe(payload.length);
    expect(JSON.parse(payload.toString("utf8"))).toEqual({
      type: "run-user-script",
      input: { kind: "script", scriptSource: "def run(): return 1" },
      cube: null,
      sandbox: true,
    });
  });

  it("measures multi-byte characters in bytes, not code units", () => {
    const frame = encodeWorkerRequestFrame({
      type: "run-user-script",
      input: { kind: "formula", expression: "# λ = 550nm" },
      cube: null,
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
