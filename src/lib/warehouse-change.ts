// Pure logic for changing the warehouse(s) on an existing order and recalibrating
// stock. The route (src/app/api/orders/[id]/warehouse/route.ts) wires DB → these
// functions → DB. Kept side-effect-free so it is unit-testable in isolation.

export type WhOrderType = "GRN" | "GOODS_OUT" | "TRANSFER" | "ADJUSTMENT";

export type Delta = { productId: string; locationId: string; delta: number };

/** Stable key for a (product, location) pair. */
export const keyOf = (productId: string, locationId: string) => `${productId}|${locationId}`;

type Line = { productId: string; quantity: number };

export type RecalcInput = {
  type: WhOrderType;
  oldFrom: string | null;
  oldTo: string | null;
  newFrom: string | null;
  newTo: string | null;
  lines: Line[];
};

// Which location fields each type actually uses.
const usesFrom = (t: WhOrderType) => t === "GOODS_OUT" || t === "TRANSFER";
const usesTo = (t: WhOrderType) => t === "GRN" || t === "ADJUSTMENT" || t === "TRANSFER";

/**
 * Net stock deltas to move an order's effect from its old warehouse(s) to its new
 * one(s): reverse the original movement at the OLD location and re-apply it at the
 * NEW one. Deltas are merged per (product, location); anything that nets to zero
 * (e.g. an unchanged side, or a same-warehouse no-op) is dropped.
 *
 * Sign convention matches the approval path: qty is added at a GRN/Transfer
 * destination, removed at a Goods-Out/Transfer source, and applied *signed* for
 * adjustments (a -5 adjustment removes 5).
 */
export function computeRecalibrationDeltas(input: RecalcInput): Delta[] {
  const { type, oldFrom, oldTo, newFrom, newTo, lines } = input;
  const acc = new Map<string, Delta>();

  const add = (productId: string, locationId: string | null, delta: number) => {
    if (!locationId || delta === 0) return;
    const k = keyOf(productId, locationId);
    const cur = acc.get(k);
    if (cur) cur.delta += delta;
    else acc.set(k, { productId, locationId, delta });
  };

  for (const line of lines) {
    const q = line.quantity;
    if (usesTo(type)) {
      // destination: original added +q at oldTo → reverse -q; re-apply +q at newTo
      add(line.productId, oldTo, -q);
      add(line.productId, newTo, q);
    }
    if (usesFrom(type)) {
      // source: original removed -q at oldFrom → reverse +q; re-apply -q at newFrom
      add(line.productId, oldFrom, q);
      add(line.productId, newFrom, -q);
    }
  }

  return [...acc.values()].filter((d) => d.delta !== 0);
}

/**
 * Given current balances (keyed by keyOf; missing = 0) and the deltas to apply,
 * return every (product, location) that would end below zero. Catches underflow on
 * BOTH the old warehouse (stock already consumed) and the new source warehouse.
 */
export function resultingNegatives(
  current: Record<string, number>,
  deltas: Delta[]
): Array<{ productId: string; locationId: string; resulting: number }> {
  const out: Array<{ productId: string; locationId: string; resulting: number }> = [];
  for (const d of deltas) {
    const resulting = (current[keyOf(d.productId, d.locationId)] ?? 0) + d.delta;
    if (resulting < 0) out.push({ productId: d.productId, locationId: d.locationId, resulting });
  }
  return out;
}

export type ValidateInput = {
  type: WhOrderType;
  oldFrom: string | null;
  oldTo: string | null;
  newFrom: string | null;
  newTo: string | null;
  activeLocationIds: string[];
};

/** Guard the requested change before any stock is touched. */
export function validateWarehouseChange(
  input: ValidateInput
): { ok: true } | { ok: false; error: string } {
  const { type, oldFrom, oldTo, newFrom, newTo, activeLocationIds } = input;
  const active = new Set(activeLocationIds);

  const changedFrom = usesFrom(type) && newFrom !== oldFrom;
  const changedTo = usesTo(type) && newTo !== oldTo;
  if (!changedFrom && !changedTo) return { ok: false, error: "Nothing changed — pick a different warehouse" };

  if (usesFrom(type)) {
    if (!newFrom) return { ok: false, error: "Source warehouse is required" };
    if (!active.has(newFrom)) return { ok: false, error: "Source warehouse is not available" };
  }
  if (usesTo(type)) {
    if (!newTo) return { ok: false, error: "Destination warehouse is required" };
    if (!active.has(newTo)) return { ok: false, error: "Destination warehouse is not available" };
  }
  if (type === "TRANSFER" && newFrom === newTo)
    return { ok: false, error: "Source and destination must be different" };

  return { ok: true };
}
