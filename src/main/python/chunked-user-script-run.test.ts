import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  createChunkedUserScriptRunSessionStore,
  type BeginChunkedUserScriptRunRequest,
  type ChunkedUserScriptRunSessionStore,
} from "./chunked-user-script-run";

function buildBeginRequest(
  overrides: Partial<BeginChunkedUserScriptRunRequest> = {},
): BeginChunkedUserScriptRunRequest {
  return {
    cube: { bandCount: 2, height: 2, width: 3, wavelengths: [400, 500] },
    resultKind: "value",
    input: { kind: "formula", expression: "cube.mean()" },
    releaseInputResources: () => Promise.resolve(),
    sourceName: null,
    interpreterPath: "python",
    sandbox: true,
    ...overrides,
  };
}

function float32BytesOf(values: number[]): Uint8Array {
  const floats = Float32Array.from(values);
  return new Uint8Array(floats.buffer.slice(0));
}

// The generator reuses one buffer across yields (consume-before-next-pull
// contract, like the real stdin writer), so each segment is copied here.
async function collectSegments(segments: AsyncIterable<Buffer>): Promise<Uint8Array> {
  const collected: Buffer[] = [];
  for await (const segment of segments) collected.push(Buffer.from(segment));
  return new Uint8Array(Buffer.concat(collected));
}

function buildStore(chunkBytes?: number): ChunkedUserScriptRunSessionStore {
  return createChunkedUserScriptRunSessionStore(chunkBytes, tmpdir());
}

describe("chunked user-script run session store", () => {
  it("spools uploaded chunks and streams the band-major cube payload back in bounded segments", async () => {
    const store = buildStore(10);
    const token = await store.begin(buildBeginRequest());
    const allBytes = float32BytesOf([1, 2, 3, 4, 5, 6, 10, 20, 30, 40, 50, 60]);
    await store.appendCubeChunk(token, allBytes.slice(0, 10));
    await store.appendCubeChunk(token, allBytes.slice(10));
    const run = store.takeExecutableRun(token);
    expect(run.cube.header).toEqual({
      shape: [2, 2, 3],
      dtype: "float32",
      wavelengths: [400, 500],
    });
    expect(run.cube.totalByteLength).toBe(allBytes.byteLength);
    expect(await collectSegments(run.cube.readSegments())).toEqual(allBytes);
    expect(run.input).toEqual({ kind: "formula", expression: "cube.mean()" });
    expect(run.sandbox).toBe(true);
    await store.release(token);
  });

  it("rejects a chunk that overflows the described stack shape", async () => {
    const store = buildStore();
    const token = await store.begin(
      buildBeginRequest({ cube: { bandCount: 1, height: 1, width: 2, wavelengths: null } }),
    );
    await store.appendCubeChunk(token, new Uint8Array(8));
    await expect(store.appendCubeChunk(token, new Uint8Array(1))).rejects.toThrow(/did not match/);
    await store.release(token);
  });

  it("rejects an empty chunk", async () => {
    const store = buildStore();
    const token = await store.begin(buildBeginRequest());
    await expect(store.appendCubeChunk(token, new Uint8Array(0))).rejects.toThrow(/did not match/);
    await store.release(token);
  });

  it("refuses to execute before every cube byte arrived", async () => {
    const store = buildStore();
    const token = await store.begin(buildBeginRequest());
    await store.appendCubeChunk(token, new Uint8Array(8));
    expect(() => store.takeExecutableRun(token)).toThrow(/did not match/);
    await store.release(token);
  });

  it("refuses a second execution of the same run", async () => {
    const store = buildStore();
    const token = await store.begin(
      buildBeginRequest({ cube: { bandCount: 1, height: 1, width: 1, wavelengths: null } }),
    );
    await store.appendCubeChunk(token, new Uint8Array(4));
    store.takeExecutableRun(token);
    expect(() => store.takeExecutableRun(token)).toThrow(/already executed/);
    await store.release(token);
  });

  it("rejects a non-positive or non-integer stack shape", async () => {
    const store = buildStore();
    await expect(
      store.begin(buildBeginRequest({ cube: { bandCount: 0, height: 2, width: 2, wavelengths: null } })),
    ).rejects.toThrow(/invalid stack shape/);
    await expect(
      store.begin(buildBeginRequest({ cube: { bandCount: 1.5, height: 2, width: 2, wavelengths: null } })),
    ).rejects.toThrow(/invalid stack shape/);
  });

  it("throws for an unknown token", async () => {
    const store = buildStore();
    await expect(store.appendCubeChunk("nope", new Uint8Array(4))).rejects.toThrow(
      /Unknown user-script run token/,
    );
  });

  it("serves a spooled cube result in bounded chunks that reassemble exactly", async () => {
    const store = buildStore(8);
    const token = await store.begin(
      buildBeginRequest({ cube: { bandCount: 1, height: 1, width: 1, wavelengths: null } }),
    );
    await store.appendCubeChunk(token, new Uint8Array(4));
    const run = store.takeExecutableRun(token);
    await writeFile(run.cubeResultSpoolPath, float32BytesOf([1, 2, 3, 4, 5, 6]));
    const summary = store.storeCubeResultForPull(token, [2, 1, 3], 24);
    expect(summary.totalBytes).toBe(24);
    const pulled: Uint8Array[] = [];
    let done = false;
    while (!done) {
      const chunk = await store.readNextResultChunk(token);
      expect(chunk.bytes.byteLength).toBeLessThanOrEqual(8);
      pulled.push(chunk.bytes);
      done = chunk.done;
    }
    expect(reassembleFloats(pulled)).toEqual([1, 2, 3, 4, 5, 6]);
    await store.release(token);
  });

  it("rejects a result byte count that disagrees with the declared shape", async () => {
    const store = buildStore();
    const token = await store.begin(
      buildBeginRequest({ cube: { bandCount: 1, height: 1, width: 1, wavelengths: null } }),
    );
    await store.appendCubeChunk(token, new Uint8Array(4));
    store.takeExecutableRun(token);
    expect(() => store.storeCubeResultForPull(token, [2, 1, 3], 4)).toThrow(
      /did not match its stack shape/,
    );
    await store.release(token);
  });

  it("throws when reading past the end of the stored result", async () => {
    const store = buildStore(64);
    const token = await store.begin(
      buildBeginRequest({ cube: { bandCount: 1, height: 1, width: 1, wavelengths: null } }),
    );
    await store.appendCubeChunk(token, new Uint8Array(4));
    const run = store.takeExecutableRun(token);
    await writeFile(run.cubeResultSpoolPath, float32BytesOf([9]));
    store.storeCubeResultForPull(token, [1, 1, 1], 4);
    expect((await store.readNextResultChunk(token)).done).toBe(true);
    await expect(store.readNextResultChunk(token)).rejects.toThrow(/already fully read/);
    await store.release(token);
  });

  it("deletes the result spool file on release", async () => {
    const store = buildStore(64);
    const token = await store.begin(
      buildBeginRequest({ cube: { bandCount: 1, height: 1, width: 1, wavelengths: null } }),
    );
    await store.appendCubeChunk(token, new Uint8Array(4));
    const run = store.takeExecutableRun(token);
    await writeFile(run.cubeResultSpoolPath, float32BytesOf([7]));
    store.storeCubeResultForPull(token, [1, 1, 1], 4);
    await store.readNextResultChunk(token);
    await store.release(token);
    expect(existsSync(run.cubeResultSpoolPath)).toBe(false);
  });

  it("releases input resources exactly once across run and release", async () => {
    let releaseCount = 0;
    const store = buildStore();
    const token = await store.begin(
      buildBeginRequest({
        cube: { bandCount: 1, height: 1, width: 1, wavelengths: null },
        releaseInputResources: () => {
          releaseCount += 1;
          return Promise.resolve();
        },
      }),
    );
    await store.appendCubeChunk(token, new Uint8Array(4));
    store.takeExecutableRun(token);
    await store.releaseInputResourcesAfterRun(token);
    await store.release(token);
    expect(releaseCount).toBe(1);
  });

  it("treats release of an unknown token as a no-op", async () => {
    const store = buildStore();
    await expect(store.release("nope")).resolves.toBeUndefined();
  });

  it("invalidates the token after release", async () => {
    const store = buildStore();
    const token = await store.begin(buildBeginRequest());
    await store.release(token);
    await expect(store.appendCubeChunk(token, new Uint8Array(4))).rejects.toThrow(
      /Unknown user-script run token/,
    );
  });
});

function reassembleFloats(chunks: Uint8Array[]): number[] {
  const totalBytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return Array.from(new Float32Array(combined.buffer));
}
