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
// itself. The user never writes the wrapping function for a formula.
export type UserScriptInput =
  | { kind: "formula"; expression: string }
  | { kind: "script"; scriptSource: string };

export interface RunUserScriptRequest {
  type: "run-user-script";
  input: UserScriptInput;
  cube: CubePayloadHeader | null;
}

export type PythonWorkerResponse =
  | { type: "script-result"; value: JsonValue }
  | { type: "script-error"; message: string; traceback?: string };

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

function parseWorkerResponsePayload(payload: Buffer): PythonWorkerResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.toString("utf8"));
  } catch {
    throw new MalformedWorkerResponseError("payload is not valid JSON");
  }
  if (isScriptResultResponse(parsed) || isScriptErrorResponse(parsed)) return parsed;
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

export class WorkerResponseFrameDecoder {
  private bufferedBytes: Buffer = Buffer.alloc(0);

  appendChunkAndTakeCompletedResponses(chunk: Buffer): PythonWorkerResponse[] {
    this.bufferedBytes = Buffer.concat([this.bufferedBytes, chunk]);
    const responses: PythonWorkerResponse[] = [];
    for (let payload = this.takeOneFramePayloadOrNull(); payload !== null; payload = this.takeOneFramePayloadOrNull()) {
      responses.push(parseWorkerResponsePayload(payload));
    }
    return responses;
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
