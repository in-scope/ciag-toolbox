// CT-216: bridges the asynchronous scripting worker to the synchronous action
// pipeline for the Custom transform. A formula or imported tool returns a whole
// transformed cube, which cannot ride through ParameterValuesById (primitives
// only) or the History inline text. The editor remembers the validated cube here
// under a short token and stores that token in rendering state; transformSource
// resolves the token back to the cube at apply time. This mirrors
// band-selection-result-store.

export interface RememberedCubeTransformResult {
  readonly shape: ReadonlyArray<number>;
  readonly bands: ReadonlyArray<Float32Array>;
}

let nextResultId = 0;
const resultsByToken = new Map<string, RememberedCubeTransformResult>();

export function rememberCubeTransformResult(result: RememberedCubeTransformResult): string {
  const token = `cube-transform-${nextResultId}`;
  nextResultId += 1;
  resultsByToken.set(token, result);
  return token;
}

export function readRememberedCubeTransformResultOrNull(
  token: string,
): RememberedCubeTransformResult | null {
  return resultsByToken.get(token) ?? null;
}

export function forgetAllCubeTransformResults(): void {
  resultsByToken.clear();
}
