import { describe, it, expect } from "vitest";
import { resolveEffectiveDate, isDateAllowed, exceedsSoftCap, latestApprovedCountFloor, parseBusinessDate } from "./effective-date";

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

  // Business dates are stored at NOON Jakarta, so a same-day instant sits in the
  // future all morning. "Today" is what the date picker offers (max={today}), so
  // it must be accepted whatever the clock says — compare calendar days, not
  // instants.
  describe("today, before noon Jakarta", () => {
    const morning = new Date("2026-08-13T02:30:00.000Z"); // 09:30 WIB

    it("allows today even though noon WIB is still ahead of now", () => {
      expect(isDateAllowed(parseBusinessDate("2026-08-13")!, null, morning)).toEqual({ ok: true });
    });

    it("still rejects tomorrow", () => {
      expect(isDateAllowed(parseBusinessDate("2026-08-14")!, null, morning)).toEqual({ ok: false, reason: "future" });
    });
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

describe("latestApprovedCountFloor", () => {
  const d = (s: string) => new Date(s);

  it("returns null when there are no approved counts", () => {
    expect(latestApprovedCountFloor([])).toBeNull();
  });

  it("prefers the business countDate over approvedAt", () => {
    const floor = latestApprovedCountFloor([
      { countDate: d("2026-06-01T23:59:59+07:00"), approvedAt: d("2026-06-10T00:00:00Z") },
    ]);
    expect(floor).toEqual(d("2026-06-01T23:59:59+07:00"));
  });

  it("falls back to approvedAt when countDate is null (legacy session)", () => {
    const floor = latestApprovedCountFloor([
      { countDate: null, approvedAt: d("2026-06-10T00:00:00Z") },
    ]);
    expect(floor).toEqual(d("2026-06-10T00:00:00Z"));
  });

  it("picks the most recent floor across multiple locations", () => {
    const floor = latestApprovedCountFloor([
      { countDate: d("2026-06-01T00:00:00Z"), approvedAt: null },
      { countDate: d("2026-06-20T00:00:00Z"), approvedAt: null }, // most recent
      { countDate: d("2026-06-10T00:00:00Z"), approvedAt: null },
    ]);
    expect(floor).toEqual(d("2026-06-20T00:00:00Z"));
  });

  it("ignores sessions with no usable date", () => {
    const floor = latestApprovedCountFloor([
      { countDate: null, approvedAt: null },
      { countDate: d("2026-06-05T00:00:00Z"), approvedAt: null },
    ]);
    expect(floor).toEqual(d("2026-06-05T00:00:00Z"));
  });
});

describe("parseBusinessDate", () => {
  it("parses a valid date to noon Asia/Jakarta", () => {
    // Noon Jakarta (UTC+7) === 05:00 UTC the same calendar day.
    expect(parseBusinessDate("2026-06-15")).toEqual(new Date("2026-06-15T05:00:00.000Z"));
  });

  it("rejects a malformed string", () => {
    expect(parseBusinessDate("15/06/2026")).toBeNull();
    expect(parseBusinessDate("2026-6-1")).toBeNull();
    expect(parseBusinessDate("")).toBeNull();
  });

  it("rejects an impossible calendar date", () => {
    expect(parseBusinessDate("2026-13-40")).toBeNull();
  });
});
