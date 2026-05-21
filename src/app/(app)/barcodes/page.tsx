import { prisma } from "@/lib/prisma";
import { BarcodePrintPanel } from "@/components/barcode-print-panel";
import { blockViewer } from "@/lib/role-guard";
import { getT } from "@/modules/i18n";

export const maxDuration = 30;

export default async function BarcodesPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string | string[]; copies?: string }>;
}) {
  await blockViewer();
  const t = await getT();
  const { productId, copies } = await searchParams;

  const [categories, products, settingRow] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.product.findMany({
      where: {
        isActive: true,
        AND: [{ OR: [{ approvalStatus: "ACTIVE" as const }, { approvalStatus: null }] }],
      },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, sku: true, barcode: true,
        colorVariant: true, isActive: true, categoryId: true,
        category: { select: { name: true } },
        unit: { select: { name: true } },
        unitConversions: { select: { id: true, name: true, conversionFactor: true, barcode: true } },
      },
    }),
    prisma.systemSetting.findUnique({ where: { key: "barcode_label_settings" } }),
  ]);

  let labelSettings: { width: number; height: number } | null = null;
  if (settingRow) {
    try { labelSettings = JSON.parse(settingRow.value); } catch { /* use defaults */ }
  }

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
      <BarcodePrintPanel products={products} categories={categories.map((c) => ({ id: c.id, name: c.name }))} preselect={preselect} initialCopies={initialCopies} labelSettings={labelSettings} />
    </div>
  );
}
