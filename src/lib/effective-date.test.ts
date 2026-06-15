import { describe, it, expect } from "vitest";
import { resolveEffectiveDate, isDateAllowed, exceedsSoftCap } from "./effective-date";

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

describe("isDateAllowed", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");
  const floor = new Date("2026-06-10T12:00:00.000Z"); // last approved opname

  it("rejects a date in the future", () => {
    const result = isDateAllowed(new Date("2026-06-16T12:00:00.000Z"), floor, now);
    expect(result).toEqual({ ok: false, reason: "future" });
  });

  it("rejects a date strictly before the opname floor", () => {
    const result = isDateAllowed(new Date("2026-06-09T12:00:00.000Z"), floor, now);
    expect(result).toEqual({ ok: false, reason: "before_opname" });
  });

  it("allows a date exactly on the opname floor", () => {
    expect(isDateAllowed(floor, floor, now)).toEqual({ ok: true });
  });

  it("allows a date after the opname floor", () => {
    expect(isDateAllowed(new Date("2026-06-12T12:00:00.000Z"), floor, now)).toEqual({ ok: true });
  });

  it("allows any past date when there is no opname floor", () => {
    expect(isDateAllowed(new Date("2020-01-01T00:00:00.000Z"), null, now)).toEqual({ ok: true });
  });
});

describe("exceedsSoftCap", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000);

  it("warns when more than 90 days back", () => {
    expect(exceedsSoftCap(daysAgo(120), now)).toBe(true);
  });

  it("does not warn within 90 days", () => {
    expect(exceedsSoftCap(daysAgo(30), now)).toBe(false);
  });

  it("does not warn at exactly 90 days (boundary)", () => {
    expect(exceedsSoftCap(daysAgo(90), now)).toBe(false);
  });
});
