// Validates the value a user formula or script returns before the app consumes it.
// The contract is strict per consumer: band selection must return an H x W band matching
// the cube's spatial dimensions; band weighting must return an N-length weight vector,
// one weight per band. Wrong shapes, non-numeric cells, and NaN/Inf are all rejected
// with a docs-linked error so the user knows exactly what to fix.
export const SCRIPTING_DOCS_HINT =
  "See the 'How to write a custom script' page for the expected return format.";

export class UserScriptReturnContractError extends Error {
  constructor(problem: string) {
    super(`${problem} ${SCRIPTING_DOCS_HINT}`);
    this.name = "UserScriptReturnContractError";
  }
}

export interface CubeSpatialDimensions {
  height: number;
  width: number;
}

export function validateBandWeightVectorReturnValue(value: unknown, bandCount: number): number[] {
  const vector = asArrayOrThrow(value, "The weight vector");
  if (vector.length !== bandCount) {
    throw new UserScriptReturnContractError(
      `The weight vector must have one weight per band (expected ${bandCount}, got ${vector.length}).`,
    );
  }
  return vector.map((weight, index) => asFiniteNumberOrThrow(weight, `Weight ${index + 1}`));
}

export function validateBandSelectionReturnValue(
  value: unknown,
  dimensions: CubeSpatialDimensions,
): number[][] {
  const rows = asArrayOrThrow(value, "The band");
  if (rows.length !== dimensions.height) {
    throw new UserScriptReturnContractError(
      `The band must have ${dimensions.height} rows (got ${rows.length}).`,
    );
  }
  return rows.map((row, rowIndex) => validateBandRow(row, rowIndex, dimensions.width));
}

function validateBandRow(row: unknown, rowIndex: number, width: number): number[] {
  const columns = asArrayOrThrow(row, `Band row ${rowIndex + 1}`);
  if (columns.length !== width) {
    throw new UserScriptReturnContractError(
      `Band row ${rowIndex + 1} must have ${width} columns (got ${columns.length}).`,
    );
  }
  return columns.map((cell, columnIndex) =>
    asFiniteNumberOrThrow(cell, `Band pixel (${columnIndex + 1}, ${rowIndex + 1})`),
  );
}

function asArrayOrThrow(value: unknown, subject: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new UserScriptReturnContractError(`${subject} must be an array (got ${describeType(value)}).`);
  }
  return value;
}

function asFiniteNumberOrThrow(value: unknown, subject: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new UserScriptReturnContractError(`${subject} must be a finite number (got ${describeValue(value)}).`);
  }
  return value;
}

function describeValue(value: unknown): string {
  return typeof value === "number" ? String(value) : describeType(value);
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  return Array.isArray(value) ? "array" : typeof value;
}
