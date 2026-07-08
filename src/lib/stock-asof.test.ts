import { describe, it, expect } from "vitest";
import {
  isApplied,
  signedDeltaAt,
  sumDeltasByProduct,
  qtyAsOf,
  parseCountDate,
  isFutureBusinessDay,
  type AsOfMovement,
} from "./stock-asof";

const L = "loc-1";
const OTHER = "loc-2";

function mv(over: Partial<AsOfMovement>): AsOfMovement {
  return {
    productId: "p1",
    orderType: "GRN",
    cancelledAt: null,
    grnStatus: null,
    goodsOutStatus: null,
    transferStatus: null,
    adjustmentStatus: null,
    fromLocationId: null,
    toLocationId: L,
    quantity: 10,
    lineQuantity: 10,
    ...over,
  };
}

describe("isApplied", () => {
  it("counts immediate (null status) and APPROVED orders", () => {
    expect(isApplied(mv({ orderType: "GRN", grnStatus: null }))).toBe(true);
    expect(isApplied(mv({ orderType: "GRN", grnStatus: "APPROVED" }))).toBe(true);
    expect(isApplied(mv({ orderType: "GOODS_OUT", goodsOutStatus: "APPROVED", fromLocationId: L, toLocationId: null }))).toBe(true);
  });
  it("excludes pending and rejected orders (stock never applied)", () => {
    expect(isApplied(mv({ grnStatus: "PENDING" }))).toBe(false);
    expect(isApplied(mv({ grnStatus: "REJECTED" }))).toBe(false);
    expect(isApplied(mv({ orderType: "ADJUSTMENT", adjustmentStatus: "PENDING" }))).toBe(false);
    expect(isApplied(mv({ orderType: "ADJUSTMENT", adjustmentStatus: "REJECTED" }))).toBe(false);
    expect(isApplied(mv({ orderType: "ADJUSTMENT", adjustmentStatus: null }))).toBe(false);
  });
  it("excludes cancelled orders (stock was reversed, movements remain)", () => {
    expect(isApplied(mv({ cancelledAt: new Date() }))).toBe(false);
  });
});

describe("signedDeltaAt", () => {
  it("GRN adds at the receiving location only", () => {
    expect(signedDeltaAt(mv({}), L)).toBe(10);
    expect(signedDeltaAt(mv({}), OTHER)).toBe(0);
  });
  it("GOODS_OUT subtracts at the source location", () => {
    const m = mv({ orderType: "GOODS_OUT", fromLocationId: L, toLocationId: null });
    expect(signedDeltaAt(m, L)).toBe(-10);
    expect(signedDeltaAt(m, OTHER)).toBe(0);
  });
  it("TRANSFER subtracts at from and adds at to", () => {
    const m = mv({ orderType: "TRANSFER", fromLocationId: L, toLocationId: OTHER });
    expect(signedDeltaAt(m, L)).toBe(-10);
    expect(signedDeltaAt(m, OTHER)).toBe(10);
  });
  it("ADJUSTMENT uses the SIGNED line quantity (movement qty is absolute)", () => {
    const down = mv({ orderType: "ADJUSTMENT", adjustmentStatus: "APPROVED", quantity: 7, lineQuantity: -7 });
    expect(signedDeltaAt(down, L)).toBe(-7);
    const up = mv({ orderType: "ADJUSTMENT", adjustmentStatus: "APPROVED", quantity: 7, lineQuantity: 7 });
    expect(signedDeltaAt(up, L)).toBe(7);
  });
  it("returns 0 for unapplied movements regardless of location", () => {
    expect(signedDeltaAt(mv({ grnStatus: "PENDING" }), L)).toBe(0);
  });
});

describe("sumDeltasByProduct + qtyAsOf (the user's scenario)", () => {
  it("count entered late: yesterday 100, today 10 out → baseline as of yesterday is 100", () => {
    // Current stock is 90; the goods-out (10) happened AFTER the count date.
    const after = [mv({ orderType: "GOODS_OUT", fromLocationId: L, toLocationId: null, quantity: 10, productId: "p1" })];
    const deltas = sumDeltasByProduct(after, L);
    const baseline = qtyAsOf(90, deltas.get("p1") ?? 0);
    expect(baseline).toBe(100); // count of 100 vs baseline 100 → no adjustment ✓
  });
  it("aggregates mixed movements per product", () => {
    const after = [
      mv({ productId: "a", orderType: "GRN", quantity: 5 }),                                        // +5
      mv({ productId: "a", orderType: "GOODS_OUT", fromLocationId: L, toLocationId: null, quantity: 3 }), // -3
      mv({ productId: "b", orderType: "TRANSFER", fromLocationId: L, toLocationId: OTHER, quantity: 4 }), // -4
      mv({ productId: "c", grnStatus: "PENDING", quantity: 99 }),                                   // ignored
    ];
    const deltas = sumDeltasByProduct(after, L);
    expect(deltas.get("a")).toBe(2);
    expect(deltas.get("b")).toBe(-4);
    expect(deltas.has("c")).toBe(false);
  });
});

describe("parseCountDate", () => {
  it("stores end-of-day Asia/Jakarta so same-day movements stay in the baseline", () => {
    const d = parseCountDate("2026-07-07")!;
    expect(d.toISOString()).toBe("2026-07-07T16:59:59.000Z"); // 23:59:59+07:00
  });
  it("rejects malformed input", () => {
    expect(parseCountDate("07/07/2026")).toBeNull();
    expect(parseCountDate("2026-13-40")).toBeNull();
  });
});

describe("isFutureBusinessDay", () => {
  it("today (Jakarta) is not future even though end-of-day is after now", () => {
    const now = new Date("2026-07-08T03:00:00Z"); // 10:00 Jakarta
    expect(isFutureBusinessDay(parseCountDate("2026-07-08")!, now)).toBe(false);
    expect(isFutureBusinessDay(parseCountDate("2026-07-07")!, now)).toBe(false);
    expect(isFutureBusinessDay(parseCountDate("2026-07-09")!, now)).toBe(true);
  });
});
