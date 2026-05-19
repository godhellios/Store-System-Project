import { prisma } from "@/lib/prisma";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export class InsufficientStockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientStockError";
  }
}

// ── Pure functions ───────────────────────────────────────────────────────────

/** Weighted average cost after receiving newQty units at newCost. */
export function calcAvco(
  prevAvg: number,
  qtyBefore: number,
  newQty: number,
  newCost: number
): number {
  if (qtyBefore === 0) return newCost;
  return (qtyBefore * prevAvg + newQty * newCost) / (qtyBefore + newQty);
}

/** True when available stock can satisfy the requested quantity. */
export function isSufficient(available: number, requested: number): boolean {
  return available >= requested;
}

/** Quantity after applying an adjustment delta. Can be negative; caller decides whether to reject. */
export function calcNewQty(current: number, delta: number): number {
  return current + delta;
}

// ── Tx functions ─────────────────────────────────────────────────────────────

/**
 * Upserts stock for a GRN receipt and optionally recalculates AVCO on the product.
 * Must be called inside prisma.$transaction.
 */
export async function applyGrnLineTx(
  tx: Tx,
  productId: string,
  locationId: string,
  quantity: number,
  cost?: number
): Promise<void> {
  await tx.stock.upsert({
    where: { productId_locationId: { productId, locationId } },
    create: { productId, locationId, quantity },
    update: { quantity: { increment: quantity } },
  });

  if (cost != null && cost > 0) {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { avgCost: true },
    });
    // Aggregate across ALL locations (post-upsert) then subtract this receipt to get pre-receipt total
    const totalAgg = await tx.stock.aggregate({
      where: { productId },
      _sum: { quantity: true },
    });
    const qtyBefore = Math.max(0, Number(totalAgg._sum.quantity ?? 0) - quantity);
    const prevAvg = Number(product?.avgCost ?? cost);
    const newAvg = calcAvco(prevAvg, qtyBefore, quantity, cost);
    await tx.product.update({
      where: { id: productId },
      data: { lastCost: cost, avgCost: newAvg },
    });
  }
}

/**
 * Atomically decrements stock for a Goods Out line.
 * Returns { ok: true } on success, or { ok: false, productName, available } if insufficient.
 * Must be called inside prisma.$transaction.
 */
export async function applyGoodsOutLineTx(
  tx: Tx,
  productId: string,
  locationId: string,
  quantity: number
): Promise<{ ok: true } | { ok: false; productName: string; available: number }> {
  const updated = await tx.$executeRaw`
    UPDATE "Stock"
    SET quantity = quantity - ${quantity}
    WHERE "productId" = ${productId}
      AND "locationId" = ${locationId}
      AND quantity >= ${quantity}
  `;
  if (updated === 0) {
    const s = await tx.stock.findUnique({
      where: { productId_locationId: { productId, locationId } },
      include: { product: { select: { name: true } } },
    });
    return { ok: false, productName: s?.product.name ?? productId, available: s?.quantity ?? 0 };
  }
  return { ok: true };
}

/**
 * Atomically moves stock from one location to another.
 * Returns { ok: true } on success, or { ok: false, productName, available } if source is insufficient.
 * Must be called inside prisma.$transaction.
 */
export async function applyTransferLineTx(
  tx: Tx,
  productId: string,
  fromLocationId: string,
  toLocationId: string,
  quantity: number
): Promise<{ ok: true } | { ok: false; productName: string; available: number }> {
  const result = await applyGoodsOutLineTx(tx, productId, fromLocationId, quantity);
  if (!result.ok) return result;
  await tx.stock.upsert({
    where: { productId_locationId: { productId, locationId: toLocationId } },
    create: { productId, locationId: toLocationId, quantity },
    update: { quantity: { increment: quantity } },
  });
  return { ok: true };
}

/**
 * Applies an adjustment delta to stock.
 * Throws InsufficientStockError if the result would be negative.
 * Must be called inside prisma.$transaction.
 */
export async function applyAdjustmentLineTx(
  tx: Tx,
  productId: string,
  locationId: string,
  delta: number
): Promise<void> {
  const existing = await tx.stock.findUnique({
    where: { productId_locationId: { productId, locationId } },
    select: { quantity: true },
  });
  const currentQty = existing?.quantity ?? 0;
  const newQty = calcNewQty(currentQty, delta);

  if (newQty < 0) {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { name: true, sku: true },
    });
    throw new InsufficientStockError(
      `Insufficient stock for "${product?.name ?? productId}" (${product?.sku ?? ""}): has ${currentQty}, adjustment would result in ${newQty}`
    );
  }

  if (existing) {
    await tx.stock.update({
      where: { productId_locationId: { productId, locationId } },
      data: { quantity: newQty },
    });
  } else {
    await tx.stock.create({ data: { productId, locationId, quantity: newQty } });
  }
}
