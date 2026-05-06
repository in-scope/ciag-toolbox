import { describe, expect, it } from "vitest";

import {
  buildDefaultParameterValuesForSchemas,
  clampNumericParameterValueToSchema,
  parseParameterValuesFromJsonString,
  serializeParameterValuesToJsonString,
  type IntegerParameterSchema,
  type NumberParameterSchema,
  type ParameterSchema,
} from "./parameter-schema";

describe("buildDefaultParameterValuesForSchemas", () => {
  it("returns an empty record when given no schemas", () => {
    const values = buildDefaultParameterValuesForSchemas([]);
    expect(values).toEqual({});
  });

  it("collects each schema's defaultValue keyed by id", () => {
    const schemas = [
      buildIntegerSchema("shift", 4),
      buildBooleanSchema("clamp", true),
      buildEnumSchema("interpolation", "linear", ["nearest", "linear"]),
    ];
    expect(buildDefaultParameterValuesForSchemas(schemas)).toEqual({
      shift: 4,
      clamp: true,
      interpolation: "linear",
    });
  });
});

describe("serializeParameterValuesToJsonString and parseParameterValuesFromJsonString", () => {
  it("round-trips a values record through JSON", () => {
    const values = { shift: 4, clamp: true, interpolation: "linear" };
    const json = serializeParameterValuesToJsonString(values);
    expect(parseParameterValuesFromJsonString(json)).toEqual(values);
  });

  it("rejects JSON that does not parse to a plain object of primitive values", () => {
    expect(() => parseParameterValuesFromJsonString("[1, 2, 3]")).toThrow();
    expect(() => parseParameterValuesFromJsonString("null")).toThrow();
    expect(() => parseParameterValuesFromJsonString('{"nested":{"x":1}}')).toThrow();
  });
});

describe("clampNumericParameterValueToSchema", () => {
  it("rounds integer schemas to the nearest integer", () => {
    const schema = buildBareIntegerSchema("shift", 4);
    expect(clampNumericParameterValueToSchema(schema, 4.6)).toBe(5);
  });

  it("clamps to the schema's min when below range", () => {
    const schema: IntegerParameterSchema = {
      ...buildBareIntegerSchema("shift", 4),
      min: 0,
      max: 8,
    };
    expect(clampNumericParameterValueToSchema(schema, -3)).toBe(0);
  });

  it("clamps to the schema's max when above range", () => {
    const schema: IntegerParameterSchema = {
      ...buildBareIntegerSchema("shift", 4),
      min: 0,
      max: 8,
    };
    expect(clampNumericParameterValueToSchema(schema, 99)).toBe(8);
  });

  it("preserves fractional values for number schemas", () => {
    const schema: NumberParameterSchema = {
      kind: "number",
      id: "x",
      label: "X",
      defaultValue: 1.0,
    };
    expect(clampNumericParameterValueToSchema(schema, 1.25)).toBe(1.25);
  });
});

function buildIntegerSchema(id: string, defaultValue: number): ParameterSchema {
  return buildBareIntegerSchema(id, defaultValue);
}

function buildBareIntegerSchema(id: string, defaultValue: number): IntegerParameterSchema {
  return { kind: "integer", id, label: id, defaultValue };
}

function buildBooleanSchema(id: string, defaultValue: boolean): ParameterSchema {
  return { kind: "boolean", id, label: id, defaultValue };
}

function buildEnumSchema(
  id: string,
  defaultValue: string,
  values: ReadonlyArray<string>,
): ParameterSchema {
  return {
    kind: "enum",
    id,
    label: id,
    defaultValue,
    options: values.map((value) => ({ value, label: value })),
  };
}
