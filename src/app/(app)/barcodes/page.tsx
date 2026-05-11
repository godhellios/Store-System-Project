import { prisma } from "@/lib/prisma";
import { BarcodePrintPanel } from "@/components/barcode-print-panel";
import { blockOperator } from "@/lib/role-guard";
import { getT } from "@/modules/i18n";

export const maxDuration = 30;

export default async function BarcodesPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string }>;
}) {
  await blockOperator();
  const t = await getT();
  const { productId } = await searchParams;

  const [categories, preselectProduct] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    productId
      ? prisma.product.findUnique({
          where: { id: productId },
          include: { category: true, unit: true, unitConversions: true },
        })
      : Promise.resolve(null),
  ]);

  const mergedProducts = preselectProduct ? [preselectProduct] : [];
  const preselect = productId ? [productId] : [];

  return (
    <div>
      <h1 className="text-base font-semibold text-slate-800 mb-5">{t("barcodes.title", "Barcode Labels")}</h1>
      <BarcodePrintPanel products={mergedProducts} categories={categories} preselect={preselect} />
    </div>
  );
}
