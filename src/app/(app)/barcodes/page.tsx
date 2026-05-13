import { prisma } from "@/lib/prisma";
import { BarcodePrintPanel } from "@/components/barcode-print-panel";
import { blockOperator } from "@/lib/role-guard";
import { getT } from "@/modules/i18n";

export const maxDuration = 30;

export default async function BarcodesPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string | string[]; copies?: string }>;
}) {
  await blockOperator();
  const t = await getT();
  const { productId, copies } = await searchParams;

  const [categories, products] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.product.findMany({
      where: {
        isActive: true,
        AND: [{ OR: [{ approvalStatus: "ACTIVE" as const }, { approvalStatus: null }] }],
      },
      orderBy: { name: "asc" },
      include: { category: true, unit: true, unitConversions: true },
    }),
  ]);

  const preselect = productId
    ? Array.isArray(productId) ? productId : [productId]
    : [];

  const initialCopies: Record<string, number> = {};
  if (copies) {
    for (const pair of copies.split(",")) {
      const i = pair.lastIndexOf(":");
      if (i > 0) {
        const id = pair.slice(0, i);
        const n = parseInt(pair.slice(i + 1));
        if (id && n > 0) initialCopies[id] = n;
      }
    }
  }

  return (
    <div>
      <h1 className="text-base font-semibold text-slate-800 mb-5">{t("barcodes.title", "Barcode Labels")}</h1>
      <BarcodePrintPanel products={products} categories={categories} preselect={preselect} initialCopies={initialCopies} />
    </div>
  );
}
