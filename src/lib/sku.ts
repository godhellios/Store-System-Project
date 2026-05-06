import { prisma } from "@/lib/prisma";

type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Generates the next available SKU for a product in the given category.
 *
 * Format: `<CATEGORY_CODE>-<5-digit sequence>` e.g. `THR-00001`
 *
 * Uses MAX-based sequencing (highest existing SKU number) so gaps in the
 * sequence do not cause duplicates. Falls back to a uniqueness check loop
 * in case of a race condition.
 *
 * @param categoryId  Prisma ID of the category
 * @param tx          Prisma transaction client (must be used inside $transaction)
 */
export async function generateSku(
  categoryId: string,
  tx: TransactionClient
): Promise<string> {
  // 1. Resolve the category and its SKU prefix code
  const category = await tx.category.findUnique({
    where: { id: categoryId },
    select: { name: true, code: true },
  });

  if (!category || !category.code) {
    throw new Error(
      `Category '${category?.name ?? categoryId}' has no code set. Admin must set it in Settings.`
    );
  }

  const code = category.code;

  // 2. Find the current highest SKU in this category (MAX-based, not COUNT)
  const last = await tx.product.findFirst({
    where: { sku: { startsWith: `${code}-` } },
    orderBy: { sku: "desc" },
    select: { sku: true },
  });

  // Parse the trailing numeric segment from the highest existing SKU
  let num = last ? parseInt(last.sku.split("-").pop() ?? "0", 10) : 0;

  // 3. Loop up to 10 attempts to find a free candidate (handles race conditions)
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = `${code}-${String(num + 1).padStart(5, "0")}`;

    const conflict = await tx.product.findUnique({
      where: { sku: candidate },
    });

    if (conflict === null) {
      return candidate;
    }

    // Candidate is taken — move forward and retry
    num += 1;
  }

  throw new Error("Could not generate unique SKU after 10 attempts");
}
