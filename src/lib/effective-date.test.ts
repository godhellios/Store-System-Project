import { describe, it, expect } from "vitest";
import { resolveEffectiveDate } from "./effective-date";

describe("resolveEffectiveDate", () => {
  const createdAt = new Date("2026-06-15T08:00:00.000Z");
  const realDate = new Date("2026-06-01T00:00:00.000Z");

  it("uses the explicit effective date when one is set (the real date wins)", () => {
    expect(resolveEffectiveDate(realDate, createdAt)).toEqual(realDate);
  });

  it("falls back to createdAt when the effective date is null", () => {
    expect(resolveEffectiveDate(null, createdAt)).toEqual(createdAt);
  });

  it("falls back to createdAt when the effective date is undefined", () => {
    expect(resolveEffectiveDate(undefined, createdAt)).toEqual(createdAt);
  });
});
