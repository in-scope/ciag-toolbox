// The Python-side half of the worker IPC boundary, shipped as a source string and
// passed to the interpreter via `-c`. This shim is product infrastructure (framing,
// cube reconstruction, dispatch, error capture); only the formula/script it executes is
// user Python. It must mirror the frame layout in worker-protocol.ts exactly: the JSON
// request frame is followed by a raw little-endian float32 cube frame when the request
// header declares a cube, and a resultKind "cube" run responds with a JSON completed
// header frame followed by one raw little-endian float32 cube frame (CT-214).
import { PYTHON_SANDBOX_INSTALL_SOURCE } from "./sandbox-policy";

export const PYTHON_WORKER_BOOTSTRAP_SOURCE = `
import inspect
import json
import struct
import sys
import traceback

REAL_STDOUT = sys.stdout.buffer
sys.stdout = sys.stderr

${PYTHON_SANDBOX_INSTALL_SOURCE}


def read_frame_payload(stream):
    header = stream.read(4)
    if len(header) < 4:
        return None
    (length,) = struct.unpack("<I", header)
    payload = stream.read(length)
    if len(payload) < length:
        return None
    return payload


def write_response_frame(payload):
    REAL_STDOUT.write(struct.pack("<I", len(payload)))
    REAL_STDOUT.write(payload)
    REAL_STDOUT.flush()


def reconstruct_cube_from_frame(cube_bytes, header):
    import numpy as np
    shape = tuple(header["shape"])
    return np.frombuffer(cube_bytes, dtype="<f4").reshape(shape).copy()


def build_formula_run_function(expression):
    import numpy as np
    try:
        code = compile(expression, "<formula>", "eval")
    except SyntaxError as error:
        raise RuntimeError("A formula must be a single Python expression: " + (error.msg or "invalid syntax"))

    def run(cube):
        return eval(code, {"np": np, "cube": cube})

    return run


def load_run_function_from_script(script_source):
    namespace = {"__name__": "__msi_user_script__"}
    exec(compile(script_source, "<user-script>", "exec"), namespace)
    run_function = namespace.get("run")
    if not callable(run_function):
        raise RuntimeError("The script must define a run() function.")
    return run_function


def load_run_function_from_package(package_directory):
    import importlib
    sys.path.insert(0, package_directory)
    main_module = importlib.import_module("main")
    run_function = getattr(main_module, "run", None)
    if not callable(run_function):
        raise RuntimeError("The tool's main.py must define a run() function.")
    return run_function


def load_run_function(input_spec):
    kind = input_spec.get("kind") if isinstance(input_spec, dict) else None
    if kind == "formula":
        return build_formula_run_function(input_spec.get("expression", ""))
    if kind == "package":
        return load_run_function_from_package(input_spec.get("packageDirectory", ""))
    return load_run_function_from_script((input_spec or {}).get("scriptSource", ""))


def count_positional_parameters(run_function):
    try:
        parameters = inspect.signature(run_function).parameters.values()
    except (TypeError, ValueError):
        return 0
    kinds = (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
    return sum(1 for parameter in parameters if parameter.kind in kinds)


def invoke_run_function(run_function, cube, wavelengths):
    positional = count_positional_parameters(run_function)
    if cube is None or positional == 0:
        return run_function()
    if positional == 1:
        return run_function(cube)
    return run_function(cube, wavelengths)


CUBE_RESULT_CONTRACT_MESSAGE = (
    "A cube transform must return a 3-dimensional numeric array shaped "
    "(bands, height, width) containing only finite values (no NaN or Inf)."
)


def is_numeric_array(array, np):
    return np.issubdtype(array.dtype, np.floating) or np.issubdtype(array.dtype, np.integer)


def coerce_result_to_finite_float32_cube(value):
    import numpy as np
    array = np.asarray(value)
    if array.ndim != 3 or not is_numeric_array(array, np):
        raise RuntimeError(CUBE_RESULT_CONTRACT_MESSAGE)
    cube = array.astype("<f4")
    if not np.all(np.isfinite(cube)):
        raise RuntimeError(CUBE_RESULT_CONTRACT_MESSAGE)
    return cube


def encode_cube_result_frames(value):
    cube = coerce_result_to_finite_float32_cube(value)
    header = encode_response({"type": "completed", "cubeShape": list(cube.shape)})
    return [header, cube.tobytes()]


def make_json_safe(value):
    numpy = sys.modules.get("numpy")
    if numpy is None:
        return value
    if isinstance(value, numpy.ndarray):
        if not numpy.all(numpy.isfinite(value)):
            raise RuntimeError("The result contains NaN or infinite values.")
        return value.tolist()
    if isinstance(value, numpy.generic):
        return value.item()
    return value


def encode_response(message):
    return json.dumps(message, allow_nan=False).encode("utf-8")


def sandbox_user_origin_prefixes(input_spec):
    if isinstance(input_spec, dict) and input_spec.get("kind") == "package":
        directory = input_spec.get("packageDirectory")
        return [directory] if directory else []
    return []


def encode_result_frames(request, value):
    if request.get("resultKind") == "cube":
        return encode_cube_result_frames(value)
    return [encode_response({"type": "script-result", "value": make_json_safe(value)})]


def run_user_code(request, cube):
    input_spec = request.get("input")
    run_function = load_run_function(input_spec)
    if request.get("sandbox"):
        install_bundled_mode_sandbox(sandbox_user_origin_prefixes(input_spec))
    wavelengths = (request.get("cube") or {}).get("wavelengths")
    value = invoke_run_function(run_function, cube, wavelengths)
    return encode_result_frames(request, value)


def handle_request(request, cube):
    if not isinstance(request, dict) or request.get("type") != "run-user-script":
        return [encode_response({"type": "script-error", "message": "Malformed worker request."})]
    try:
        return run_user_code(request, cube)
    except BaseException as error:
        message = str(error) or type(error).__name__
        return [encode_response({"type": "script-error", "message": message, "traceback": traceback.format_exc()})]


def read_cube_if_present(request, stream):
    header = request.get("cube") if isinstance(request, dict) else None
    if header is None:
        return None
    cube_bytes = read_frame_payload(stream)
    if cube_bytes is None:
        raise RuntimeError("The cube payload frame was missing.")
    return reconstruct_cube_from_frame(cube_bytes, header)


def main():
    request_payload = read_frame_payload(sys.stdin.buffer)
    if request_payload is None:
        return
    request = json.loads(request_payload.decode("utf-8"))
    try:
        cube = read_cube_if_present(request, sys.stdin.buffer)
    except BaseException as error:
        write_response_frame(encode_response({"type": "script-error", "message": str(error)}))
        return
    for frame_payload in handle_request(request, cube):
        write_response_frame(frame_payload)


main()
`;
