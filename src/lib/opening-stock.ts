// Pure, DB-free logic for the Opening Stock import.
// The route handler (src/app/api/opening-stock/route.ts) supplies the data
// (products, locations, existing stock) and persists the result; everything
// here is testable in isolation. See src/lib/opening-stock.test.ts.

export type ParsedRow = { sku: string; location: string; qty: string; unitCost: string };

export type ValidatedRow = {
  sku: string;
  productName: string | null;
  productId: string | null;
  location: string;
  locationId: string | null;
  qty: number;
  unitCost: number | null;
  status: "ok" | "warning" | "error" | "skip";
  message?: string;
};

export type OpeningStockProduct = { id: string; sku: string; name: string };
export type OpeningStockLocation = { id: string; name: string };
export type ExistingStock = { productId: string; locationId: string; quantity: number };

/**
 * Parse and validate raw CSV rows against the known products and locations.
 *
 * - Fully blank rows are dropped.
 * - Bad SKU / location / qty / unitCost → `error` (each kept distinct).
 * - A product+location seen more than once in the file → last value wins,
 *   flagged `warning`.
 *
 * Does NOT consult existing stock — call `applySkipProtect` afterwards for that.
 */
export function validateOpeningStockRows(
  rows: ParsedRow[],
  products: OpeningStockProduct[],
  locations: OpeningStockLocation[],
): ValidatedRow[] {
  const productBySku = new Map(products.map((p) => [p.sku.toLowerCase(), p]));
  const locationByName = new Map(locations.map((l) => [l.name.toLowerCase(), l]));

  // Keyed by `${productId}:${locationId}` for valid rows (so duplicates collapse),
  // and by a unique `err:N` for error rows (so they never collapse into each other).
  const dedupeMap = new Map<string, ValidatedRow>();
  let errIdx = 0;

  for (const raw of rows) {
    const sku = raw.sku?.trim() ?? "";
    const location = raw.location?.trim() ?? "";
    const qtyRaw = raw.qty?.trim() ?? "";
    const unitCostRaw = raw.unitCost?.trim() ?? "";

    // Skip rows the user left blank (most rows in the template will be empty)
    if (!sku && !location && !qtyRaw) continue;

    const product = productBySku.get(sku.toLowerCase());
    if (!product) {
      dedupeMap.set(`err:${errIdx++}`, {
        sku: sku || "(empty)",
        productName: null,
        productId: null,
        location,
        locationId: null,
        qty: 0,
        unitCost: null,
        status: "error",
        message: sku ? `SKU "${sku}" not found or inactive` : "SKU is required",
      });
      continue;
    }

    const loc = locationByName.get(location.toLowerCase());
    if (!loc) {
      dedupeMap.set(`err:${errIdx++}`, {
        sku,
        productName: product.name,
        productId: product.id,
        location: location || "(empty)",
        locationId: null,
        qty: 0,
        unitCost: null,
        status: "error",
        message: location ? `Location "${location}" not found` : "Location is required",
      });
      continue;
    }

    const qty = parseInt(qtyRaw, 10);
    if (isNaN(qty) || qty <= 0) {
      dedupeMap.set(`err:${errIdx++}`, {
        sku,
        productName: product.name,
        productId: product.id,
        location: loc.name,
        locationId: loc.id,
        qty: 0,
        unitCost: null,
        status: "error",
        message: `Qty "${qtyRaw}" must be a positive whole number`,
      });
      continue;
    }

    let unitCost: number | null = null;
    if (unitCostRaw) {
      unitCost = parseFloat(unitCostRaw);
      if (isNaN(unitCost) || unitCost <= 0) {
        dedupeMap.set(`err:${errIdx++}`, {
          sku,
          productName: product.name,
          productId: product.id,
          location: loc.name,
          locationId: loc.id,
          qty,
          unitCost: null,
          status: "error",
          message: `UnitCost "${unitCostRaw}" must be a positive number`,
        });
        continue;
      }
    }

    const key = `${product.id}:${loc.id}`;
    const isDuplicate = dedupeMap.has(key);
    dedupeMap.set(key, {
      sku,
      productName: product.name,
      productId: product.id,
      location: loc.name,
      locationId: loc.id,
      qty,
      unitCost,
      status: isDuplicate ? "warning" : "ok",
      message: isDuplicate ? "Duplicate in file — this row overwrites the earlier one" : undefined,
    });
  }

  return Array.from(dedupeMap.values());
}

/**
 * Protect existing balances: any importable row whose product+location already
 * has stock (qty > 0) is flipped to `skip`, never overwritten. Opening stock is
 * a first-time-only set; changing an existing balance is done via an Adjustment.
 *
 * Mutates `validated` in place and returns it for convenience.
 */
export function applySkipProtect(
  validated: ValidatedRow[],
  existingStock: ExistingStock[],
): ValidatedRow[] {
  const stockMap = new Map(existingStock.map((s) => [`${s.productId}:${s.locationId}`, s.quantity]));
  for (const row of validated) {
    if ((row.status === "ok" || row.status === "warning") && row.productId && row.locationId) {
      const existing = stockMap.get(`${row.productId}:${row.locationId}`);
      if (existing && existing > 0) {
        row.status = "skip";
        row.message = `Already has stock of ${existing.toLocaleString()} — skipped (use an Adjustment to change it)`;
      }
    }
  }
  return validated;
}

/** Rows that will actually be written: fresh balances (`ok`) and in-file duplicates (`warning`). */
export function importableRows(validated: ValidatedRow[]): ValidatedRow[] {
  return validated.filter(
    (r) => (r.status === "ok" || r.status === "warning") && r.productId && r.locationId,
  );
}

/**
 * Weighted-average cost per product across the rows being imported.
 * Rows with no unitCost are ignored; a product with no priced rows is absent
 * from the result (its cost is left untouched).
 */
export function computeOpeningStockCosts(toImport: ValidatedRow[]): Map<string, number> {
  const totals = new Map<string, { totalQty: number; totalCost: number }>();
  for (const row of toImport) {
    if (row.unitCost != null && row.productId) {
      const existing = totals.get(row.productId) ?? { totalQty: 0, totalCost: 0 };
      totals.set(row.productId, {
        totalQty: existing.totalQty + row.qty,
        totalCost: existing.totalCost + row.qty * row.unitCost,
      });
    }
  }

  const avgByProduct = new Map<string, number>();
  for (const [productId, { totalQty, totalCost }] of totals) {
    avgByProduct.set(productId, totalCost / totalQty);
  }
  return avgByProduct;
}
