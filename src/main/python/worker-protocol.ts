// Typed IPC protocol between the TS/Node worker harness and the Python subprocess.
// Every message travels as a frame: a 4-byte little-endian uint32 payload length
// followed by that many bytes of UTF-8 JSON. Length-prefixed framing (rather than
// newline-delimited) so later stories can add raw binary payload frames (CT-208b).

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface RunUserScriptRequest {
  type: "run-user-script";
  scriptSource: string;
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

export function encodeWorkerRequestFrame(request: RunUserScriptRequest): Buffer {
  const payload = Buffer.from(JSON.stringify(request), "utf8");
  const header = Buffer.alloc(FRAME_LENGTH_HEADER_BYTES);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
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
