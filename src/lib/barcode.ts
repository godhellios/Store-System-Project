import { prisma } from "@/lib/prisma";

type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Returns the base barcode for a product — identical to its SKU.
 * Kept as a named function so callers never hardcode the derivation rule.
 */
export function generateBaseBarcode(sku: string): string {
  return sku;
}

/**
 * Returns a unit-level barcode by appending the unit suffix to the SKU.
 * Returns null when suffix is absent or empty (unit has no scannable barcode).
 *
 * Example: generateUnitBarcode("THR-00043", "BOX") → "THR-00043-BOX"
 */
export function generateUnitBarcode(
  sku: string,
  suffix: string | null | undefined
): string | null {
  if (!suffix) return null;
  return `${sku}-${suffix}`;
}

/**
 * Checks that none of the provided barcodes are already assigned to another
 * product or unit conversion. Throws a descriptive Error on the first conflict.
 *
 * Both DB lookups run in parallel via Promise.all.
 *
 * @param barcodes  List of candidate barcode values to validate
 * @param tx        Prisma transaction client
 */
export async function validateBarcodeUniqueness(
  barcodes: string[],
  tx: TransactionClient
): Promise<void> {
  const [productConflict, unitConflict] = await Promise.all([
    tx.product.findFirst({
      where: { barcode: { in: barcodes } },
      select: { barcode: true, name: true },
    }),
    tx.productUnitConversion.findFirst({
      where: { barcode: { in: barcodes } },
      select: { barcode: true, productId: true },
    }),
  ]);

  if (productConflict) {
    throw new Error(
      `Barcode '${productConflict.barcode}' is already in use by product '${productConflict.name}'`
    );
  }

  if (unitConflict) {
    throw new Error(
      `Barcode '${unitConflict.barcode}' is already in use by another unit conversion`
    );
  }
}
