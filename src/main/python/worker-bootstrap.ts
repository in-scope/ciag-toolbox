// The Python-side half of the worker IPC boundary, shipped as a source string and
// passed to the interpreter via `-c`. This shim is product infrastructure (framing,
// dispatch, error capture); only the scriptSource it executes is user Python.
// It must mirror the frame layout in worker-protocol.ts exactly.
export const PYTHON_WORKER_BOOTSTRAP_SOURCE = `
import json
import struct
import sys
import traceback

REAL_STDOUT = sys.stdout.buffer
sys.stdout = sys.stderr


def read_request_frame(stream):
    header = stream.read(4)
    if len(header) < 4:
        return None
    (length,) = struct.unpack("<I", header)
    payload = stream.read(length)
    if len(payload) < length:
        return None
    return json.loads(payload.decode("utf-8"))


def write_response_frame(payload):
    REAL_STDOUT.write(struct.pack("<I", len(payload)))
    REAL_STDOUT.write(payload)
    REAL_STDOUT.flush()


def call_user_run_function(script_source):
    namespace = {"__name__": "__msi_user_script__"}
    exec(compile(script_source, "<user-script>", "exec"), namespace)
    run_function = namespace.get("run")
    if not callable(run_function):
        raise RuntimeError("The script must define a run() function.")
    return run_function()


def encode_response(message):
    return json.dumps(message).encode("utf-8")


def handle_request(request):
    if not isinstance(request, dict) or request.get("type") != "run-user-script":
        return encode_response({"type": "script-error", "message": "Malformed worker request."})
    try:
        value = call_user_run_function(request.get("scriptSource", ""))
        return encode_response({"type": "script-result", "value": value})
    except BaseException as error:
        message = str(error) or type(error).__name__
        return encode_response(
            {"type": "script-error", "message": message, "traceback": traceback.format_exc()}
        )


def main():
    request = read_request_frame(sys.stdin.buffer)
    if request is None:
        return
    write_response_frame(handle_request(request))


main()
`;
