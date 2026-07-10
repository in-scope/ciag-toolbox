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
  // Where the worker writes a cube result's raw little-endian float32 bytes
  // (band-major), CT-219g: a multi-gigabyte stdout frame makes the reading
  // Electron main process allocate ONE buffer for all available pipe bytes,
  // fatally exceeding its 2 GiB single-allocation cap, so the bulk bytes never
  // ride the pipe. null for value-kind runs.
  cubeResultSpoolPath: string | null;
  // Bundled mode (default for the app's own interpreter) is sandboxed; own-environment
  // mode (CT-208e) is explicitly trusted and passes false. The sandbox itself lives in
  // the Python bootstrap (sandbox-policy.ts); this flag only toggles installing it.
  sandbox: boolean;
}

export type CubeResultShape = [number, number, number];

// CT-219g: a cube result's bytes never cross stdout; the worker spools them to
// the request's cubeResultSpoolPath and this response only announces shape and size.
export type PythonWorkerResponse =
  | { type: "script-result"; value: JsonValue }
  | { type: "script-error"; message: string; traceback?: string }
  | { type: "cube-result"; shape: CubeResultShape; totalBytes: number };

// The wire message a cube-result run sends after spooling its raw bytes.
interface CompletedCubeMessage {
  type: "completed";
  cubeShape: CubeResultShape;
  spooledByteLength: number;
}

export class MalformedWorkerResponseError extends Error {
  constructor(detail: string) {
    super(`Malformed response from the Python worker: ${detail}`);
    this.name = "MalformedWorkerResponseError";
  }
}

const FRAME_LENGTH_HEADER_BYTES = 4;
const MAX_FRAME_PAYLOAD_BYTES = 0xffff_ffff;

// The frame prefix of a payload that is written as multiple segments (the
// CT-219g cube path): a reference-scale cube cannot exist as one Buffer, so
// the sender writes this prefix followed by each segment.
export function encodeFrameLengthPrefix(payloadByteLength: number): Buffer {
  if (payloadByteLength > MAX_FRAME_PAYLOAD_BYTES) {
    throw new Error("The stack is too large to send to the script worker (4 GB frame limit).");
  }
  const header = Buffer.alloc(FRAME_LENGTH_HEADER_BYTES);
  header.writeUInt32LE(payloadByteLength, 0);
  return header;
}

function prefixWithLittleEndianByteLength(payload: Buffer): Buffer {
  return Buffer.concat([encodeFrameLengthPrefix(payload.length), payload]);
}

export function encodeWorkerRequestFrame(request: RunUserScriptRequest): Buffer {
  return prefixWithLittleEndianByteLength(Buffer.from(JSON.stringify(request), "utf8"));
}

// The raw cube frame that follows a request whose header declares a cube; it uses the
// same length-prefixed framing so the Python side reads it exactly like a JSON frame.
export function encodeRawBinaryFrame(payload: Buffer): Buffer {
  return prefixWithLittleEndianByteLength(payload);
}

function parseWorkerResponsePayload(payload: Buffer): PythonWorkerResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.toString("utf8"));
  } catch {
    throw new MalformedWorkerResponseError("payload is not valid JSON");
  }
  if (isScriptResultResponse(parsed) || isScriptErrorResponse(parsed)) return parsed;
  if (isCompletedCubeMessage(parsed)) return cubeResultFromCompletedMessage(parsed);
  throw new MalformedWorkerResponseError("payload is not a known response message");
}

function cubeResultFromCompletedMessage(message: CompletedCubeMessage): PythonWorkerResponse {
  const [bandCount, height, width] = message.cubeShape;
  if (bandCount * height * width * FLOAT32_BYTES !== message.spooledByteLength) {
    throw new MalformedWorkerResponseError("cube payload length does not match its declared shape");
  }
  return { type: "cube-result", shape: message.cubeShape, totalBytes: message.spooledByteLength };
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

function isCompletedCubeMessage(candidate: unknown): candidate is CompletedCubeMessage {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    (candidate as { type?: unknown }).type === "completed" &&
    isCubeResultShape((candidate as { cubeShape?: unknown }).cubeShape) &&
    Number.isInteger((candidate as { spooledByteLength?: unknown }).spooledByteLength)
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

export class WorkerResponseFrameDecoder {
  // Frames buffer as a chunk list with ONE concatenation per COMPLETED frame,
  // never per arriving chunk: at hundreds of megabytes (a JSON band result at
  // reference scale) per-chunk concatenation is quadratic. Cube results are
  // JSON-only on this pipe (the bulk bytes go to the spool file, CT-219g), so
  // no frame here ever approaches the gigabyte danger zone.
  private bufferedChunks: Buffer[] = [];
  private bufferedByteLength = 0;

  appendChunkAndTakeCompletedResponses(chunk: Buffer): PythonWorkerResponse[] {
    this.pushBufferedChunk(chunk);
    const responses: PythonWorkerResponse[] = [];
    for (
      let payload = this.takeOneBufferedFramePayloadOrNull();
      payload !== null;
      payload = this.takeOneBufferedFramePayloadOrNull()
    ) {
      responses.push(parseWorkerResponsePayload(payload));
    }
    return responses;
  }

  private pushBufferedChunk(input: Buffer): void {
    if (input.length === 0) return;
    this.bufferedChunks.push(input);
    this.bufferedByteLength += input.length;
  }

  private takeOneBufferedFramePayloadOrNull(): Buffer | null {
    const payloadLength = this.peekFrameLengthOrNull();
    if (payloadLength === null) return null;
    const frameEnd = FRAME_LENGTH_HEADER_BYTES + payloadLength;
    if (this.bufferedByteLength < frameEnd) return null;
    const all = this.takeAllBufferedBytes();
    this.pushBufferedChunk(all.subarray(frameEnd));
    return all.subarray(FRAME_LENGTH_HEADER_BYTES, frameEnd);
  }

  private peekFrameLengthOrNull(): number | null {
    if (this.bufferedByteLength < FRAME_LENGTH_HEADER_BYTES) return null;
    this.coalesceBufferedChunksWhenLengthPrefixIsSplit();
    return this.bufferedChunks[0]!.readUInt32LE(0);
  }

  private coalesceBufferedChunksWhenLengthPrefixIsSplit(): void {
    const first = this.bufferedChunks[0];
    if (first === undefined || first.length >= FRAME_LENGTH_HEADER_BYTES) return;
    this.bufferedChunks = [Buffer.concat(this.bufferedChunks)];
  }

  private takeAllBufferedBytes(): Buffer {
    const all = this.bufferedChunks.length === 1 ? this.bufferedChunks[0]! : Buffer.concat(this.bufferedChunks);
    this.bufferedChunks = [];
    this.bufferedByteLength = 0;
    return all;
  }
}
