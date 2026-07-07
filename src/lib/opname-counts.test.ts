import { describe, it, expect } from "vitest";
import { diffCountUpdates, type ExistingLine } from "./opname-counts";

const existing: ExistingLine[] = [
  { id: "a", physicalQty: null, staffConfirmed: false, bookQty: 10 }, // stocked, uncounted
  { id: "b", physicalQty: null, staffConfirmed: false, bookQty: 0 },  // unstocked (found-item candidate)
  { id: "c", physicalQty: 5, staffConfirmed: false, bookQty: 5 },     // already counted, matches
];

describe("diffCountUpdates", () => {
  it("only returns lines that changed (leaves the other 1000s untouched)", () => {
    const out = diffCountUpdates(existing, [
      { id: "a", physicalQty: 8 },        // counted → change
      { id: "b", physicalQty: null },     // still blank → no change
      { id: "c", physicalQty: 5 },        // same value → no change
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ id: "a", physicalQty: 8, difference: -2, staffConfirmed: false });
  });

  it("keeps a blank box as not-counted (null qty, null difference) — never a phantom zero", () => {
    const out = diffCountUpdates(
      [{ id: "a", physicalQty: 3, staffConfirmed: false, bookQty: 10 }],
      [{ id: "a", physicalQty: null }], // cleared
    );
    expect(out[0]).toEqual({ id: "a", physicalQty: null, difference: null, staffConfirmed: false });
  });

  it("computes difference against book qty for a found (unstocked) product", () => {
    const out = diffCountUpdates(existing, [{ id: "b", physicalQty: 7 }]);
    expect(out[0]).toEqual({ id: "b", physicalQty: 7, difference: 7, staffConfirmed: false });
  });

  it("treats an explicit zero as a real count (difference vs book), not as blank", () => {
    const out = diffCountUpdates(existing, [{ id: "a", physicalQty: 0 }]);
    expect(out[0]).toEqual({ id: "a", physicalQty: 0, difference: -10, staffConfirmed: false });
  });

  it("detects a staffConfirmed change even when the qty is unchanged", () => {
    const out = diffCountUpdates(
      [{ id: "c", physicalQty: 5, staffConfirmed: false, bookQty: 5 }],
      [{ id: "c", physicalQty: 5, staffConfirmed: true }],
    );
    expect(out).toHaveLength(1);
    expect(out[0].staffConfirmed).toBe(true);
  });

  it("ignores ids that aren't on the session", () => {
    const out = diffCountUpdates(existing, [{ id: "zzz", physicalQty: 9 }]);
    expect(out).toHaveLength(0);
  });

  it("returns nothing when a full save has no changes (the common re-save case)", () => {
    const out = diffCountUpdates(existing, existing.map((e) => ({ id: e.id, physicalQty: e.physicalQty, staffConfirmed: e.staffConfirmed })));
    expect(out).toHaveLength(0);
  });
});
