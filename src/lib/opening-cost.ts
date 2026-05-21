import { prisma } from "@/lib/prisma";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export class OpeningCostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpeningCostError";
  }
}

/**
 * Sets avgCost + lastCost on a product only when avgCost is currently NULL.
 * Throws OpeningCostError if avgCost is already set.
 */
export async function applyOpeningCost(tx: Tx, productId: string, cost: number): Promise<void> {
  if (cost <= 0) throw new Error("Cost must be greater than zero");

  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, sku: true, avgCost: true },
  });
  if (!product) throw new Error(`Product ${productId} not found`);
  if (product.avgCost !== null) {
    throw new OpeningCostError(
      `Product "${product.name}" already has cost data. Use correctCost to override.`
    );
  }

  await tx.product.update({
    where: { id: productId },
    data: { avgCost: cost, lastCost: cost },
  });
}

/**
 * Overrides avgCost + lastCost regardless of current value.
 * Returns the old avgCost for use in audit log descriptions.
 */
export async function applyCorrectCost(
  tx: Tx,
  productId: string,
  cost: number
): Promise<{ oldAvgCost: number | null }> {
  if (cost <= 0) throw new Error("Cost must be greater than zero");

  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, sku: true, avgCost: true },
  });
  if (!product) throw new Error(`Product ${productId} not found`);

  const oldAvgCost = product.avgCost !== null ? Number(product.avgCost) : null;

  await tx.product.update({
    where: { id: productId },
    data: { avgCost: cost, lastCost: cost },
  });

  return { oldAvgCost };
}

export type CostPostPassRow = {
  productId: string;
  openingCost: number | undefined;
  correctCost: number | undefined;
};

/**
 * Post-pass for CSV import: applies openingCost (NULL-safe) or correctCost (override)
 * for a batch of rows. Returns count of products actually updated.
 */
export async function applyCostPostPass(tx: Tx, rows: CostPostPassRow[]): Promise<number> {
  let updated = 0;

  for (const row of rows) {
    const { productId, openingCost, correctCost } = row;

    // correctCost takes priority over openingCost
    if (correctCost && correctCost > 0) {
      await tx.product.update({
        where: { id: productId },
        data: { avgCost: correctCost, lastCost: correctCost },
      });
      updated++;
      continue;
    }

    if (openingCost && openingCost > 0) {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { avgCost: true },
      });
      if (product?.avgCost !== null) continue; // safety: skip if already has cost
      await tx.product.update({
        where: { id: productId },
        data: { avgCost: openingCost, lastCost: openingCost },
      });
      updated++;
    }
  }

  return updated;
}
