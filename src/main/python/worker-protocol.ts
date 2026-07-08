// Typed IPC protocol between the TS/Node worker harness and the Python subprocess.
// Every message travels as a frame: a 4-byte little-endian uint32 payload length
// followed by that many bytes of UTF-8 JSON. Length-prefixed framing (rather than
// newline-delimited) so later stories can add raw binary payload frames (CT-208b).

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

// The band cube travels as a separate raw little-endian float32 frame (NOT JSON-encoded
// arrays); this header, carried in the JSON request, tells the Python side how to
// reshape it into a numpy array of shape (bands, height, width) plus its wavelengths.
export interface CubePayloadHeader {
  shape: [number, number, number];
  dtype: "float32";
  wavelengths: number[] | null;
}

// A formula is a single expression the worker wraps as run(cube); a script defines run
// itself; a package is a multi-module tool extracted to a directory whose top-level
// main.py defines run. The user never writes the wrapping function for a formula.
export type UserScriptInput =
  | { kind: "formula"; expression: string }
  | { kind: "script"; scriptSource: string }
  | { kind: "package"; packageDirectory: string };

// 'value' results come back as JSON (weight vectors, bands); 'cube' results come back
// as a JSON header frame followed by one raw little-endian float32 frame, because
// JSON-encoding a whole transformed cube would cost megabytes of text (CT-214).
export type UserScriptResultKind = "value" | "cube";

export interface RunUserScriptRequest {
  type: "run-user-script";
  input: UserScriptInput;
  cube: CubePayloadHeader | null;
  resultKind: UserScriptResultKind;
  // Bundled mode (default for the app's own interpreter) is sandboxed; own-environment
  // mode (CT-208e) is explicitly trusted and passes false. The sandbox itself lives in
  // the Python bootstrap (sandbox-policy.ts); this flag only toggles installing it.
  sandbox: boolean;
}

export type CubeResultShape = [number, number, number];

export type PythonWorkerResponse =
  | { type: "script-result"; value: JsonValue }
  | { type: "script-error"; message: string; traceback?: string }
  | { type: "cube-result"; shape: CubeResultShape; bands: Float32Array[] };

// The wire header a cube-result run sends before its raw float32 frame; the decoder
// folds the pair into a single in-memory cube-result response.
interface CompletedCubeHeaderMessage {
  type: "completed";
  cubeShape: CubeResultShape;
}

export class MalformedWorkerResponseError extends Error {
  constructor(detail: string) {
    super(`Malformed response from the Python worker: ${detail}`);
    this.name = "MalformedWorkerResponseError";
  }
}

const FRAME_LENGTH_HEADER_BYTES = 4;

function prefixWithLittleEndianByteLength(payload: Buffer): Buffer {
  const header = Buffer.alloc(FRAME_LENGTH_HEADER_BYTES);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export function encodeWorkerRequestFrame(request: RunUserScriptRequest): Buffer {
  return prefixWithLittleEndianByteLength(Buffer.from(JSON.stringify(request), "utf8"));
}

// The raw cube frame that follows a request whose header declares a cube; it uses the
// same length-prefixed framing so the Python side reads it exactly like a JSON frame.
export function encodeRawBinaryFrame(payload: Buffer): Buffer {
  return prefixWithLittleEndianByteLength(payload);
}

function parseWorkerResponsePayload(payload: Buffer): PythonWorkerResponse | CompletedCubeHeaderMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.toString("utf8"));
  } catch {
    throw new MalformedWorkerResponseError("payload is not valid JSON");
  }
  if (isScriptResultResponse(parsed) || isScriptErrorResponse(parsed)) return parsed;
  if (isCompletedCubeHeaderMessage(parsed)) return parsed;
  throw new MalformedWorkerResponseError("payload is not a known response message");
}

function isScriptResultResponse(candidate: unknown): candidate is PythonWorkerResponse {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    (candidate as { type?: unknown }).type === "script-result" &&
    "value" in candidate
  );
}

function isScriptErrorResponse(candidate: unknown): candidate is PythonWorkerResponse {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    (candidate as { type?: unknown }).type === "script-error" &&
    typeof (candidate as { message?: unknown }).message === "string"
  );
}

function isCompletedCubeHeaderMessage(candidate: unknown): candidate is CompletedCubeHeaderMessage {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    (candidate as { type?: unknown }).type === "completed" &&
    isCubeResultShape((candidate as { cubeShape?: unknown }).cubeShape)
  );
}

function isCubeResultShape(candidate: unknown): candidate is CubeResultShape {
  return (
    Array.isArray(candidate) &&
    candidate.length === 3 &&
    candidate.every((dimension) => Number.isInteger(dimension) && dimension >= 0)
  );
}

const FLOAT32_BYTES = 4;

function splitRawCubePayloadIntoBands(payload: Buffer, shape: CubeResultShape): Float32Array[] {
  const [bandCount, height, width] = shape;
  const bandByteLength = height * width * FLOAT32_BYTES;
  if (payload.length !== bandCount * bandByteLength) {
    throw new MalformedWorkerResponseError("cube payload length does not match its declared shape");
  }
  return Array.from({ length: bandCount }, (_, bandIndex) =>
    copyLittleEndianBytesAsFloat32Array(payload, bandIndex * bandByteLength, height * width),
  );
}

// Copies into a fresh Float32Array instead of viewing the buffer: frame payloads are
// subarrays at arbitrary byte offsets, and Float32Array views require 4-byte alignment.
function copyLittleEndianBytesAsFloat32Array(payload: Buffer, byteStart: number, floatCount: number): Float32Array {
  const values = new Float32Array(floatCount);
  new Uint8Array(values.buffer).set(payload.subarray(byteStart, byteStart + floatCount * FLOAT32_BYTES));
  return values;
}

export class WorkerResponseFrameDecoder {
  private bufferedBytes: Buffer = Buffer.alloc(0);
  private pendingCubeShape: CubeResultShape | null = null;

  appendChunkAndTakeCompletedResponses(chunk: Buffer): PythonWorkerResponse[] {
    this.bufferedBytes = Buffer.concat([this.bufferedBytes, chunk]);
    const responses: PythonWorkerResponse[] = [];
    for (let payload = this.takeOneFramePayloadOrNull(); payload !== null; payload = this.takeOneFramePayloadOrNull()) {
      const response = this.interpretFramePayload(payload);
      if (response !== null) responses.push(response);
    }
    return responses;
  }

  // A completed-cube header only announces the raw float32 frame that follows; it
  // yields null here and the pair surfaces as one cube-result on the next frame.
  private interpretFramePayload(payload: Buffer): PythonWorkerResponse | null {
    if (this.pendingCubeShape !== null) return this.finishPendingCubeResult(payload);
    const parsed = parseWorkerResponsePayload(payload);
    if (parsed.type === "completed") {
      this.pendingCubeShape = parsed.cubeShape;
      return null;
    }
    return parsed;
  }

  private finishPendingCubeResult(payload: Buffer): PythonWorkerResponse {
    const shape = this.pendingCubeShape as CubeResultShape;
    this.pendingCubeShape = null;
    return { type: "cube-result", shape, bands: splitRawCubePayloadIntoBands(payload, shape) };
  }

  private takeOneFramePayloadOrNull(): Buffer | null {
    if (this.bufferedBytes.length < FRAME_LENGTH_HEADER_BYTES) return null;
    const payloadLength = this.bufferedBytes.readUInt32LE(0);
    const frameEnd = FRAME_LENGTH_HEADER_BYTES + payloadLength;
    if (this.bufferedBytes.length < frameEnd) return null;
    const payload = this.bufferedBytes.subarray(FRAME_LENGTH_HEADER_BYTES, frameEnd);
    this.bufferedBytes = this.bufferedBytes.subarray(frameEnd);
    return payload;
  }
}
