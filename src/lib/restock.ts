// Smart restock suggestions — PURE logic, no DB / no I/O.
//
// Given current stock, recent out-velocity, reorder points and packaging, it
// ranks which products to reorder and how much. It WRITES NOTHING; it is a lens
// over data the system already records (the API layer gathers the inputs and
// calls this). Keeping it pure makes it fully unit-testable and trivially
// removable.

export type RestockUrgency = "out" | "critical" | "low" | "watch";

export type RestockInput = {
  productId: string;
  name: string;
  sku: string;
  category: string;
  unit: string;
  reorderPoint: number;
  currentStock: number;
  totalOut: number; // base units shipped OUT during the velocity window
  lastCost: number | null;
  lastSupplier: string | null;
  boxFactor: number | null; // largest packaging factor (>1) to round orders up to, or null
};

export type RestockRow = RestockInput & {
  avgDailyOut: number; // base units/day over the window
  daysOfStock: number | null; // how long current stock lasts at avgDailyOut; null if no velocity
  suggestedQty: number; // base units to order to reach the coverage target
  estCost: number | null; // suggestedQty × lastCost, or null when cost unknown
  urgency: RestockUrgency;
};

const URGENCY_RANK: Record<RestockUrgency, number> = { out: 0, critical: 1, low: 2, watch: 3 };

// Round an order quantity up to a whole number of boxes when packaging is known,
// so staff order "3 boxes" not "29 pcs".
export function roundUpToBox(qty: number, boxFactor: number | null): number {
  if (qty <= 0) return 0;
  if (boxFactor && boxFactor > 1) return Math.ceil(qty / boxFactor) * boxFactor;
  return Math.ceil(qty);
}

function urgencyOf(currentStock: number, reorderPoint: number, daysOfStock: number | null): RestockUrgency {
  if (currentStock <= 0) return "out";
  if (daysOfStock != null && daysOfStock <= 7) return "critical";
  if (reorderPoint > 0 && currentStock <= reorderPoint) return "low";
  return "watch";
}

export function computeRestockSuggestions(
  items: RestockInput[],
  opts: { dayRange: number; coverageDays?: number }
): RestockRow[] {
  const dayRange = Math.max(1, opts.dayRange);
  const coverageDays = Math.max(1, opts.coverageDays ?? 30);

  const rows: RestockRow[] = [];
  for (const it of items) {
    const avgDailyOut = it.totalOut / dayRange;
    const daysOfStock = avgDailyOut > 0 ? Math.round(it.currentStock / avgDailyOut) : null;

    // Target = enough to cover `coverageDays` of demand, but never below the
    // reorder point the business set by hand.
    const demandTarget = Math.ceil(avgDailyOut * coverageDays);
    const target = Math.max(it.reorderPoint, demandTarget);
    const suggestedQty = roundUpToBox(Math.max(0, target - it.currentStock), it.boxFactor);

    const belowReorder = it.reorderPoint > 0 && it.currentStock <= it.reorderPoint;
    // Only surface products that actually need action.
    if (suggestedQty <= 0 && !belowReorder) continue;

    const urgency = urgencyOf(it.currentStock, it.reorderPoint, daysOfStock);
    const estCost = it.lastCost != null ? Math.round(suggestedQty * it.lastCost * 100) / 100 : null;

    rows.push({
      ...it,
      avgDailyOut: Math.round(avgDailyOut * 10) / 10,
      daysOfStock,
      suggestedQty,
      estCost,
      urgency,
    });
  }

  rows.sort((a, b) => {
    const ru = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
    if (ru !== 0) return ru;
    // Within a tier, soonest-to-run-out first (no-velocity rows last).
    const da = a.daysOfStock ?? Number.POSITIVE_INFINITY;
    const db = b.daysOfStock ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return b.totalOut - a.totalOut;
  });

  return rows;
}
