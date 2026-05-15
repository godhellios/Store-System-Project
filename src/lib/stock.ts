// Core stock business logic — extracted for testability.
// All functions that touch the DB accept a Prisma-compatible transaction client
// so tests can inject an in-memory store without a real database.

// ── Pure functions (no DB access) ────────────────────────────────────────────

/**
 * Returns a list of human-readable shortage descriptions for any line where
 * available stock is less than the requested quantity. Empty = all OK.
 */
export function checkSufficientStock(
  lines: Array<{ productId: string; quantity: number }>,
  stockMap: Map<string, { quantity: number; name: string }>,
): string[] {
  const shortages: string[] = [];
  for (const line of lines) {
    const record = stockMap.get(line.productId);
    const available = record?.quantity ?? 0;
    if (available < line.quantity) {
      const name = record?.name ?? line.productId;
      shortages.push(`"${name}" — available: ${available}, requested: ${line.quantity}`);
    }
  }
  return shortages;
}

/**
 * Computes the new stock quantity after applying an adjustment delta.
 * Throws if the result would be negative.
 */
export function applyAdjustmentDelta(currentQty: number, delta: number): number {
  const newQty = currentQty + delta;
  if (newQty < 0) {
    throw new Error(
      `Adjustment would result in negative stock: current ${currentQty}, delta ${delta} → ${newQty}`,
    );
  }
  return newQty;
}

/**
 * Converts a user-entered quantity in a packaging unit to base units.
 * e.g. toBaseUnits(2, 12) === 24  (2 boxes × 12 pieces/box)
 */
export function toBaseUnits(inputQty: number, conversionFactor: number): number {
  return Math.round(inputQty * conversionFactor);
}

// ── Typed tx interface ────────────────────────────────────────────────────────
// Minimal subset of the Prisma transaction client needed for stock operations.

export interface StockTx {
  stock: {
    upsert(args: {
      where: { productId_locationId: { productId: string; locationId: string } };
      create: { productId: string; locationId: string; quantity: number };
      update: { quantity: { increment: number } };
    }): Promise<unknown>;
    update(args: {
      where: { productId_locationId: { productId: string; locationId: string } };
      data: { quantity: { decrement?: number; increment?: number } | number };
    }): Promise<unknown>;
    findUnique(args: {
      where: { productId_locationId: { productId: string; locationId: string } };
      select: { quantity: boolean };
    }): Promise<{ quantity: number } | null>;
    create(args: {
      data: { productId: string; locationId: string; quantity: number };
    }): Promise<unknown>;
  };
  product: {
    findUnique(args: {
      where: { id: string };
      select: { name: boolean; sku: boolean };
    }): Promise<{ name: string; sku: string } | null>;
  };
}

export type StockLine = { productId: string; quantity: number };

// ── Thrown for negative-balance adjustments ───────────────────────────────────

export class InsufficientStockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientStockError";
  }
}

// ── TX-accepting approval functions ──────────────────────────────────────────

/** GRN approval: upserts stock at destination for every line. */
export async function applyGrnApproval(
  tx: StockTx,
  lines: StockLine[],
  toLocationId: string,
): Promise<void> {
  for (const line of lines) {
    await tx.stock.upsert({
      where: { productId_locationId: { productId: line.productId, locationId: toLocationId } },
      create: { productId: line.productId, locationId: toLocationId, quantity: line.quantity },
      update: { quantity: { increment: line.quantity } },
    });
  }
}

/** Goods Out approval: decrements stock at source for every line. */
export async function applyGoodsOutApproval(
  tx: StockTx,
  lines: StockLine[],
  fromLocationId: string,
): Promise<void> {
  for (const line of lines) {
    await tx.stock.update({
      where: { productId_locationId: { productId: line.productId, locationId: fromLocationId } },
      data: { quantity: { decrement: line.quantity } },
    });
  }
}

/** Transfer approval: decrements source and upserts destination for every line. */
export async function applyTransferApproval(
  tx: StockTx,
  lines: StockLine[],
  fromLocationId: string,
  toLocationId: string,
): Promise<void> {
  for (const line of lines) {
    await tx.stock.update({
      where: { productId_locationId: { productId: line.productId, locationId: fromLocationId } },
      data: { quantity: { decrement: line.quantity } },
    });
    await tx.stock.upsert({
      where: { productId_locationId: { productId: line.productId, locationId: toLocationId } },
      create: { productId: line.productId, locationId: toLocationId, quantity: line.quantity },
      update: { quantity: { increment: line.quantity } },
    });
  }
}

/**
 * Adjustment approval: validates ALL lines first, then applies.
 * Throws InsufficientStockError before modifying any stock if any line
 * would result in a negative quantity.
 */
export async function applyAdjustmentApproval(
  tx: StockTx,
  lines: StockLine[],
  toLocationId: string,
): Promise<void> {
  // Pass 1 — validate every line without touching stock
  const planned: Array<{
    productId: string;
    newQty: number;
    exists: boolean;
  }> = [];

  for (const line of lines) {
    const existing = await tx.stock.findUnique({
      where: { productId_locationId: { productId: line.productId, locationId: toLocationId } },
      select: { quantity: true },
    });
    const currentQty = existing?.quantity ?? 0;
    const newQty = currentQty + line.quantity;

    if (newQty < 0) {
      const product = await tx.product.findUnique({
        where: { id: line.productId },
        select: { name: true, sku: true },
      });
      throw new InsufficientStockError(
        `Insufficient stock for "${product?.name ?? line.productId}" (${product?.sku ?? ""}): ` +
          `current ${currentQty}, adjustment ${line.quantity} → ${newQty}`,
      );
    }

    planned.push({ productId: line.productId, newQty, exists: existing !== null });
  }

  // Pass 2 — apply (only reached when all lines are valid)
  for (const { productId, newQty, exists } of planned) {
    if (exists) {
      await tx.stock.update({
        where: { productId_locationId: { productId, locationId: toLocationId } },
        data: { quantity: newQty },
      });
    } else {
      await tx.stock.create({
        data: { productId, locationId: toLocationId, quantity: newQty },
      });
    }
  }
}
