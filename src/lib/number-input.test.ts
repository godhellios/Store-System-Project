import { describe, it, expect } from "vitest";
import { parseNumberInput, clampNumber } from "./number-input";

describe("parseNumberInput", () => {
  it("treats blank as null (not entered)", () => {
    expect(parseNumberInput("")).toBeNull();
    expect(parseNumberInput("   ")).toBeNull();
  });

  it("parses a whole number", () => {
    expect(parseNumberInput("5")).toBe(5);
    expect(parseNumberInput("15")).toBe(15);
    expect(parseNumberInput("  7 ")).toBe(7);
  });

  it("rejects non-numeric text as null", () => {
    expect(parseNumberInput("abc")).toBeNull();
    expect(parseNumberInput("1.2.3")).toBeNull();
    expect(parseNumberInput("5x")).toBeNull();
  });

  it("rejects decimals for integer fields", () => {
    expect(parseNumberInput("1.5")).toBeNull();
  });

  it("keeps decimals when allowDecimal is true", () => {
    expect(parseNumberInput("1.5", { allowDecimal: true })).toBe(1.5);
    expect(parseNumberInput("0.25", { allowDecimal: true })).toBe(0.25);
  });

  it("does not clamp — clamping is a separate concern", () => {
    // Below a would-be min is still returned as-is; the component clamps on blur.
    expect(parseNumberInput("0")).toBe(0);
    expect(parseNumberInput("-3")).toBe(-3);
  });
});

describe("clampNumber", () => {
  it("raises a value below min up to min", () => {
    expect(clampNumber(0, { min: 1 })).toBe(1);
    expect(clampNumber(-5, { min: 0 })).toBe(0);
  });

  it("lowers a value above max down to max", () => {
    expect(clampNumber(500, { max: 99 })).toBe(99);
  });

  it("leaves an in-range value unchanged", () => {
    expect(clampNumber(5, { min: 1, max: 10 })).toBe(5);
  });

  it("works with no bounds", () => {
    expect(clampNumber(42, {})).toBe(42);
  });
});
