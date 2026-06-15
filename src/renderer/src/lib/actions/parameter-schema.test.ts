import { describe, expect, it } from "vitest";

import {
  buildDefaultParameterValuesForSchemas,
  clampNumericParameterValueToSchema,
  describeBandScopeBlockingErrorOrNull,
  parseParameterValuesFromJsonString,
  readBandRangeTextOrEmpty,
  readCubeScopeChoiceOrDefault,
  resolveCubeScopeSelection,
  seedBandScopeBandRangeDefaults,
  serializeParameterValuesToJsonString,
  type CubeScopeParameterSchema,
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

describe("resolveCubeScopeSelection", () => {
  it("maps the full-cube choice to a full-cube selection ignoring selected bands", () => {
    expect(resolveCubeScopeSelection("full-cube", [0, 1, 2])).toEqual({ scope: "full-cube" });
  });

  it("keeps a single band-wise selection distinct from full cube", () => {
    expect(resolveCubeScopeSelection("band-wise", [2])).toEqual({
      scope: "band-wise",
      bandIndexes: [2],
    });
  });

  it("sorts and dedupes a multi-band band-wise selection", () => {
    expect(resolveCubeScopeSelection("band-wise", [3, 1, 1, 0])).toEqual({
      scope: "band-wise",
      bandIndexes: [0, 1, 3],
    });
  });

  it("resolves an all-bands band-wise selection to every selected index", () => {
    expect(resolveCubeScopeSelection("band-wise", [0, 1, 2, 3])).toEqual({
      scope: "band-wise",
      bandIndexes: [0, 1, 2, 3],
    });
  });
});

describe("readCubeScopeChoiceOrDefault", () => {
  it("accepts the two valid scope choices", () => {
    expect(readCubeScopeChoiceOrDefault("full-cube", "band-wise")).toBe("full-cube");
    expect(readCubeScopeChoiceOrDefault("band-wise", "full-cube")).toBe("band-wise");
  });

  it("falls back when the stored value is not a scope choice", () => {
    expect(readCubeScopeChoiceOrDefault(7, "full-cube")).toBe("full-cube");
    expect(readCubeScopeChoiceOrDefault("nonsense", "band-wise")).toBe("band-wise");
  });
});

describe("cube-scope schema in the parameter values flow", () => {
  it("records its default choice and round-trips through JSON serialization", () => {
    const values = buildDefaultParameterValuesForSchemas([buildCubeScopeSchema()]);
    expect(values).toEqual({ scope: "full-cube" });
    const json = serializeParameterValuesToJsonString({ scope: "band-wise" });
    expect(parseParameterValuesFromJsonString(json)).toEqual({ scope: "band-wise" });
  });
});

describe("seedBandScopeBandRangeDefaults", () => {
  it("seeds each cube-scope schema's band-range id with the current band number", () => {
    const seeded = seedBandScopeBandRangeDefaults([buildCubeScopeSchema()], { scope: "full-cube" }, 3);
    expect(seeded).toEqual({ scope: "full-cube", bandRange: "3" });
  });

  it("leaves values untouched when there is no cube-scope schema", () => {
    const seeded = seedBandScopeBandRangeDefaults([buildBareIntegerSchema("shift", 4)], { shift: 4 }, 3);
    expect(seeded).toEqual({ shift: 4 });
  });
});

describe("readBandRangeTextOrEmpty", () => {
  it("returns a stored string verbatim", () => {
    expect(readBandRangeTextOrEmpty("1-5,10")).toBe("1-5,10");
  });

  it("falls back to an empty string for non-string or missing values", () => {
    expect(readBandRangeTextOrEmpty(undefined)).toBe("");
    expect(readBandRangeTextOrEmpty(7)).toBe("");
  });
});

describe("describeBandScopeBlockingErrorOrNull", () => {
  it("returns null for a full-cube selection regardless of band range", () => {
    const error = describeBandScopeBlockingErrorOrNull([buildCubeScopeSchema()], { scope: "full-cube" }, 10);
    expect(error).toBeNull();
  });

  it("returns null for a valid band-wise range", () => {
    const values = { scope: "band-wise", bandRange: "1-3,5" };
    expect(describeBandScopeBlockingErrorOrNull([buildCubeScopeSchema()], values, 10)).toBeNull();
  });

  it("reports an error for an out-of-range band-wise range", () => {
    const values = { scope: "band-wise", bandRange: "99" };
    expect(describeBandScopeBlockingErrorOrNull([buildCubeScopeSchema()], values, 10)).toMatch(/out of range/i);
  });

  it("reports an error for an empty band-wise range", () => {
    const values = { scope: "band-wise", bandRange: "" };
    expect(describeBandScopeBlockingErrorOrNull([buildCubeScopeSchema()], values, 10)).not.toBeNull();
  });
});

function buildCubeScopeSchema(): CubeScopeParameterSchema {
  return {
    kind: "cube-scope",
    id: "scope",
    label: "Scope",
    defaultValue: "full-cube",
    bandRangeParameterId: "bandRange",
  };
}

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
