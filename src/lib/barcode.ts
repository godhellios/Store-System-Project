import type { prisma } from "@/lib/prisma";

type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Returns the base barcode for a product — identical to its SKU.
 * Kept as a named function so callers never hardcode the derivation rule.
 */
export function generateBaseBarcode(sku: string): string {
  return sku;
}

const UNIT_BARCODE_BASE = 90000000;

/**
 * Reserves `count` sequential numeric unit barcodes (e.g. "90001118") via an
 * atomic SystemSetting counter — safe under concurrent requests.
 *
 * Why numeric: packing-unit barcodes must print scannably on 40mm label stock.
 * The old `SKU-SUFFIX` style (e.g. "THR-00415-BOXOF", ~200 Code128 modules)
 * physically cannot fit at a readable bar width; 8-digit numeric codes use the
 * dense Code128C mode (~79 modules) and print with thicker bars than even the
 * base SKU barcodes. All 1,117 pre-existing codes were migrated to this scheme
 * on 2026-06-10 (codes 90000001–90001117; originals in _backup_unit_barcodes_20260610).
 */
export async function reserveUnitBarcodes(
  count: number,
  db: TransactionClient | typeof prisma
): Promise<string[]> {
  if (count <= 0) return [];
  const result = await db.$queryRaw<Array<{ value: string }>>`
    INSERT INTO "SystemSetting" (key, value, "updatedAt")
    VALUES ('unit_barcode_seq', ${String(count)}, NOW())
    ON CONFLICT (key) DO UPDATE
      SET value       = (CAST("SystemSetting".value AS BIGINT) + ${count})::text,
          "updatedAt" = NOW()
    RETURNING value
  `;
  const end = parseInt(result[0].value);
  return Array.from({ length: count }, (_, i) =>
    String(UNIT_BARCODE_BASE + end - count + 1 + i)
  );
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
