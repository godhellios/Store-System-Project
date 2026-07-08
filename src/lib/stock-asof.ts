// ─────────────────────────────────────────────────────────────────────────────
// "Stock as of a past date" — pure logic for backdated opname baselines.
//
// Stock.quantity is a live running balance that is never recomputed. To learn
// what the balance WAS at the end of business day D, we roll it back: take the
// current quantity and subtract every stock delta that happened AFTER D:
//
//   qtyAsOf(D) = currentQty − Σ signedDelta(movements with businessDate > D)
//
// Movement caveats (verified against the write paths):
//  - Movement rows are created when an order is ENTERED, even while it is still
//    PENDING (stock not applied yet) — and they survive cancellation (stock is
//    reversed but movements remain). So a movement only counts when its parent
//    order's stock was actually applied: not cancelled, and the per-type status
//    is APPROVED or null (null = applied immediately at entry). Adjustments are
//    only ever applied when adjustmentStatus === "APPROVED".
//  - Movement.quantity is stored as an ABSOLUTE value. For adjustments the sign
//    lives on the order line (signed delta), so callers must supply it.
// ─────────────────────────────────────────────────────────────────────────────

export type AsOfMovement = {
  productId: string;
  /** Parent order's type — determines the sign convention. */
  orderType: "GRN" | "GOODS_OUT" | "TRANSFER" | "ADJUSTMENT";
  cancelledAt: Date | null;
  grnStatus: string | null;
  goodsOutStatus: string | null;
  transferStatus: string | null;
  adjustmentStatus: string | null;
  fromLocationId: string | null;
  toLocationId: string | null;
  /** Movement quantity (absolute value, base units). */
  quantity: number;
  /** Signed quantity from the parent order line (sign source for adjustments). */
  lineQuantity: number;
};

/** Did this movement's parent order actually apply stock (and keep it applied)? */
export function isApplied(m: AsOfMovement): boolean {
  if (m.cancelledAt) return false; // cancel reverses stock but keeps movements
  switch (m.orderType) {
    case "GRN":
      return m.grnStatus === null || m.grnStatus === "APPROVED";
    case "GOODS_OUT":
      return m.goodsOutStatus === null || m.goodsOutStatus === "APPROVED";
    case "TRANSFER":
      return m.transferStatus === null || m.transferStatus === "APPROVED";
    case "ADJUSTMENT":
      return m.adjustmentStatus === "APPROVED"; // PENDING/REJECTED never touched stock
  }
}

/**
 * The signed stock change this movement caused AT the given location.
 * Returns 0 when the movement doesn't touch the location or was never applied.
 */
export function signedDeltaAt(m: AsOfMovement, locationId: string): number {
  if (!isApplied(m)) return 0;
  switch (m.orderType) {
    case "GRN":
      return m.toLocationId === locationId ? m.quantity : 0;
    case "GOODS_OUT":
      return m.fromLocationId === locationId ? -m.quantity : 0;
    case "TRANSFER":
      if (m.fromLocationId === locationId) return -m.quantity;
      if (m.toLocationId === locationId) return m.quantity;
      return 0;
    case "ADJUSTMENT":
      // Signed delta comes from the order line; movement.quantity is |delta|.
      return m.toLocationId === locationId ? m.lineQuantity : 0;
  }
}

/** Sum the per-product signed deltas of `movements` at one location. */
export function sumDeltasByProduct(movements: AsOfMovement[], locationId: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of movements) {
    const d = signedDeltaAt(m, locationId);
    if (d !== 0) out.set(m.productId, (out.get(m.productId) ?? 0) + d);
  }
  return out;
}

/** Roll a live balance back below the deltas that happened after the as-of date. */
export function qtyAsOf(currentQty: number, deltaAfter: number): number {
  return currentQty - deltaAfter;
}

/**
 * A count date means "counted at END of that business day": movements dated on
 * the count's own day are part of the baseline; only later ones roll back.
 * Stored as 23:59:59 Asia/Jakarta so the calendar day survives every timezone.
 */
export function parseCountDate(dateStr: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const d = new Date(`${dateStr}T23:59:59+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Business-day (Asia/Jakarta) comparison: is `proposed` on a future calendar day? */
export function isFutureBusinessDay(proposed: Date, now: Date): boolean {
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }); // YYYY-MM-DD
  return day(proposed) > day(now);
}
