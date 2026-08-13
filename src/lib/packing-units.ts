// ─────────────────────────────────────────────────────────────────────────────
// Packing units — the larger units a product can be ENTERED in (1 Box = 12 Gross).
//
// A packing unit is a row in the Unit master with a parent and a factor:
//
//     Unit "Box Of 500 Yard"  parent = Gross   conversionFactor = 12
//         → 1 Box Of 500 Yard = 12 Gross
//
// The factor is therefore only meaningful for a product whose BASE unit is that
// unit's parent. Offering "Box Of 500 Yard" (12 Gross) on a product counted in
// Dozen silently means "12 Dozen", which is a twelfth of the real box — exactly
// the error found on 3 thread products in production before this rule existed.
//
// Nothing here reads the database; the callers pass in the units they loaded.
// ─────────────────────────────────────────────────────────────────────────────

export type MasterUnit = {
  id: string;
  name: string;
  isActive: boolean;
  parentUnitId: string | null;
  conversionFactor: number | null;
};

/**
 * The units that may be offered as packing units for a product with this base
 * unit: active, with a factor above zero, and whose parent IS the base unit.
 * A unit is never offered as packing for itself (1 Box = 1 Box is meaningless).
 * Order is preserved so callers control sorting.
 */
export function eligiblePackingUnits(units: MasterUnit[], baseUnitId: string | null | undefined): MasterUnit[] {
  if (!baseUnitId) return [];
  return units.filter(
    (u) =>
      u.isActive &&
      u.id !== baseUnitId &&
      u.parentUnitId === baseUnitId &&
      typeof u.conversionFactor === "number" &&
      u.conversionFactor > 0,
  );
}

/** Is this unit a legal packing choice for that base unit? Server-side guard. */
export function isEligiblePackingUnit(
  unit: MasterUnit | null | undefined,
  baseUnitId: string | null | undefined,
): boolean {
  if (!unit || !baseUnitId) return false;
  return eligiblePackingUnits([unit], baseUnitId).length === 1;
}

/**
 * How many base units one of this packing unit holds. Returns null when the
 * unit carries no usable factor, so callers must decide what to do rather than
 * silently treating it as 1 (which would under-count a whole box).
 */
export function packingFactorOf(unit: Pick<MasterUnit, "conversionFactor"> | null | undefined): number | null {
  const f = unit?.conversionFactor;
  return typeof f === "number" && f > 0 ? f : null;
}

/** A stored packing unit as every screen wants to read it: name + factor inline. */
export type PackingView = {
  id: string;
  name: string;
  conversionFactor: number;
  barcode: string | null;
};

export type StoredPacking = {
  id: string;
  barcode?: string | null;
  unit: { name: string; conversionFactor: number | null };
};

/**
 * Flatten stored packing units for display/entry, reading the name and factor
 * from the Unit master. Rows whose unit has no usable factor are DROPPED rather
 * than defaulting to 1 — a box silently worth one piece would under-count stock.
 * Every screen goes through here so none of them re-invents the fallback.
 */
export function packingViews(rows: StoredPacking[]): PackingView[] {
  const out: PackingView[] = [];
  for (const r of rows) {
    const factor = packingFactorOf(r.unit);
    if (factor === null) continue;
    out.push({ id: r.id, name: r.unit.name, conversionFactor: factor, barcode: r.barcode ?? null });
  }
  return out;
}

/**
 * Human label for a packing unit, e.g. "Box Of 500 Yard (12 Gross)".
 * `baseUnitName` is the product's base unit — the thing the factor counts.
 */
export function packingUnitLabel(
  unit: Pick<MasterUnit, "name" | "conversionFactor">,
  baseUnitName: string,
): string {
  const f = packingFactorOf(unit);
  return f === null ? unit.name : `${unit.name} (${f} ${baseUnitName})`;
}
