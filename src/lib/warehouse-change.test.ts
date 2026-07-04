import { describe, it, expect } from "vitest";
import {
  computeRecalibrationDeltas,
  resultingNegatives,
  validateWarehouseChange,
  keyOf,
} from "./warehouse-change";

// Helper: turn the delta list into a { "product|location": delta } lookup so
// assertions read as "where did stock end up", not "what shape did we return".
const asMap = (deltas: { productId: string; locationId: string; delta: number }[]) =>
  Object.fromEntries(deltas.map((d) => [keyOf(d.productId, d.locationId), d.delta]));

// ── computeRecalibrationDeltas: net stock movement per order type ─────────────

describe("computeRecalibrationDeltas", () => {
  it("GRN destination change moves the received qty from old warehouse to new", () => {
    const deltas = computeRecalibrationDeltas({
      type: "GRN", oldFrom: null, oldTo: "A", newFrom: null, newTo: "B",
      lines: [{ productId: "p", quantity: 10 }],
    });
    expect(asMap(deltas)).toEqual({ "p|A": -10, "p|B": 10 });
  });

  it("Goods Out source change returns qty to old warehouse and removes it from new", () => {
    const deltas = computeRecalibrationDeltas({
      type: "GOODS_OUT", oldFrom: "A", oldTo: null, newFrom: "B", newTo: null,
      lines: [{ productId: "p", quantity: 10 }],
    });
    expect(asMap(deltas)).toEqual({ "p|A": 10, "p|B": -10 });
  });

  it("Transfer with only the source changed leaves the unchanged destination untouched", () => {
    // from A→C, to stays B. B's reverse (+/-) cancels, so only A and C move.
    const deltas = computeRecalibrationDeltas({
      type: "TRANSFER", oldFrom: "A", oldTo: "B", newFrom: "C", newTo: "B",
      lines: [{ productId: "p", quantity: 10 }],
    });
    expect(asMap(deltas)).toEqual({ "p|A": 10, "p|C": -10 });
  });

  it("Transfer with both warehouses changed recalibrates all four sides", () => {
    const deltas = computeRecalibrationDeltas({
      type: "TRANSFER", oldFrom: "A", oldTo: "B", newFrom: "C", newTo: "D",
      lines: [{ productId: "p", quantity: 10 }],
    });
    expect(asMap(deltas)).toEqual({ "p|A": 10, "p|B": -10, "p|C": -10, "p|D": 10 });
  });

  it("Adjustment preserves the signed quantity when moving warehouses", () => {
    // a -5 adjustment at A: reversing it ADDS 5 back at A, re-applying REMOVES 5 at B.
    const deltas = computeRecalibrationDeltas({
      type: "ADJUSTMENT", oldFrom: null, oldTo: "A", newFrom: null, newTo: "B",
      lines: [{ productId: "p", quantity: -5 }],
    });
    expect(asMap(deltas)).toEqual({ "p|A": 5, "p|B": -5 });
  });

  it("multiple lines of the same product net into one delta per warehouse", () => {
    const deltas = computeRecalibrationDeltas({
      type: "GRN", oldFrom: null, oldTo: "A", newFrom: null, newTo: "B",
      lines: [{ productId: "p", quantity: 10 }, { productId: "p", quantity: 5 }],
    });
    expect(asMap(deltas)).toEqual({ "p|A": -15, "p|B": 15 });
  });

  it("no real move (same warehouse) produces no stock change", () => {
    const deltas = computeRecalibrationDeltas({
      type: "GRN", oldFrom: null, oldTo: "A", newFrom: null, newTo: "A",
      lines: [{ productId: "p", quantity: 10 }],
    });
    expect(deltas).toEqual([]);
  });
});

// ── resultingNegatives: catch underflow on EITHER warehouse ───────────────────

describe("resultingNegatives", () => {
  it("flags the OLD warehouse going negative when its stock was already consumed", () => {
    // GRN received 10 at A but only 3 remain (7 moved out); reversing -10 underflows A.
    const neg = resultingNegatives({ "p|A": 3 }, [
      { productId: "p", locationId: "A", delta: -10 },
      { productId: "p", locationId: "B", delta: 10 },
    ]);
    expect(neg).toEqual([{ productId: "p", locationId: "A", resulting: -7 }]);
  });

  it("returns nothing when every affected warehouse stays at or above zero", () => {
    const neg = resultingNegatives({ "p|B": 100 }, [
      { productId: "p", locationId: "B", delta: -10 },
    ]);
    expect(neg).toEqual([]);
  });

  it("treats a missing stock row as zero (a decrement there is negative)", () => {
    const neg = resultingNegatives({}, [{ productId: "p", locationId: "B", delta: -5 }]);
    expect(neg).toEqual([{ productId: "p", locationId: "B", resulting: -5 }]);
  });
});

// ── validateWarehouseChange: reject bad edits before any stock is touched ──────

describe("validateWarehouseChange", () => {
  const active = ["A", "B", "C"];

  it("accepts a real change to an active warehouse", () => {
    expect(validateWarehouseChange({
      type: "GRN", oldFrom: null, oldTo: "A", newFrom: null, newTo: "B", activeLocationIds: active,
    })).toEqual({ ok: true });
  });

  it("rejects a no-op (destination unchanged)", () => {
    const res = validateWarehouseChange({
      type: "GRN", oldFrom: null, oldTo: "A", newFrom: null, newTo: "A", activeLocationIds: active,
    });
    expect(res.ok).toBe(false);
  });

  it("rejects a transfer whose source equals its destination", () => {
    const res = validateWarehouseChange({
      type: "TRANSFER", oldFrom: "A", oldTo: "B", newFrom: "C", newTo: "C", activeLocationIds: active,
    });
    expect(res.ok).toBe(false);
  });

  it("rejects a change to a warehouse that is not active/known", () => {
    const res = validateWarehouseChange({
      type: "GRN", oldFrom: null, oldTo: "A", newFrom: null, newTo: "Z", activeLocationIds: active,
    });
    expect(res.ok).toBe(false);
  });
});
