import { describe, expect, it } from "vitest";

import {
  PYTHON_SANDBOX_ADDRESS_SPACE_LIMIT_BYTES,
  PYTHON_SANDBOX_ALLOWED_IMPORT_ROOTS,
  PYTHON_SANDBOX_DENIED_AUDIT_EVENTS,
  PYTHON_SANDBOX_INSTALL_SOURCE,
} from "./sandbox-policy";

describe("PYTHON_SANDBOX_ALLOWED_IMPORT_ROOTS", () => {
  it("allows the bundled scientific stack", () => {
    expect(PYTHON_SANDBOX_ALLOWED_IMPORT_ROOTS).toEqual(
      expect.arrayContaining(["numpy", "scipy", "skimage"]),
    );
  });

  it("allows a curated pure-computation stdlib subset", () => {
    expect(PYTHON_SANDBOX_ALLOWED_IMPORT_ROOTS).toEqual(
      expect.arrayContaining(["math", "statistics", "itertools", "functools", "json", "re"]),
    );
  });

  it("does not allow capability-bearing modules a user might import directly", () => {
    for (const forbidden of ["os", "sys", "socket", "subprocess", "ctypes", "shutil", "pathlib", "urllib"]) {
      expect(PYTHON_SANDBOX_ALLOWED_IMPORT_ROOTS).not.toContain(forbidden);
    }
  });
});

describe("PYTHON_SANDBOX_DENIED_AUDIT_EVENTS", () => {
  it("denies the network, subprocess, and native-code capability events", () => {
    expect(PYTHON_SANDBOX_DENIED_AUDIT_EVENTS).toEqual(
      expect.arrayContaining(["socket.connect", "subprocess.Popen", "os.system", "ctypes.dlopen"]),
    );
  });
});

describe("PYTHON_SANDBOX_INSTALL_SOURCE", () => {
  it("installs an audit hook as its enforcement mechanism", () => {
    expect(PYTHON_SANDBOX_INSTALL_SOURCE).toContain("sys.addaudithook");
    expect(PYTHON_SANDBOX_INSTALL_SOURCE).toContain("def install_bundled_mode_sandbox");
  });

  it("bounds address space via resource.setrlimit and embeds the byte limit", () => {
    expect(PYTHON_SANDBOX_INSTALL_SOURCE).toContain("RLIMIT_AS");
    expect(PYTHON_SANDBOX_INSTALL_SOURCE).toContain(String(PYTHON_SANDBOX_ADDRESS_SPACE_LIMIT_BYTES));
  });

  it("pre-imports the curated stack before adding the hook so libraries load unrestricted", () => {
    const preimportIndex = PYTHON_SANDBOX_INSTALL_SOURCE.indexOf("_sandbox_preimport_curated_stack()");
    const addHookIndex = PYTHON_SANDBOX_INSTALL_SOURCE.indexOf("addaudithook");
    expect(preimportIndex).toBeGreaterThanOrEqual(0);
    expect(preimportIndex).toBeLessThan(addHookIndex);
  });

  it("interpolates the allowlist and denylist as Python-parseable literals", () => {
    expect(PYTHON_SANDBOX_INSTALL_SOURCE).toContain(JSON.stringify(PYTHON_SANDBOX_ALLOWED_IMPORT_ROOTS));
    expect(PYTHON_SANDBOX_INSTALL_SOURCE).toContain(JSON.stringify(PYTHON_SANDBOX_DENIED_AUDIT_EVENTS));
  });
});
