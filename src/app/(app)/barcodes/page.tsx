import { prisma } from "@/lib/prisma";
import { BarcodePrintPanel } from "@/components/barcode-print-panel";
import { blockOperator } from "@/lib/role-guard";

export default async function BarcodesPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string; categoryId?: string; q?: string }>;
}) {
  await blockOperator();
  const params = await searchParams;

  const where = {
    isActive: true,
    ...(params.q ? { OR: [{ name: { contains: params.q, mode: "insensitive" as const } }, { sku: { contains: params.q, mode: "insensitive" as const } }] } : {}),
    ...(params.categoryId ? { categoryId: params.categoryId } : {}),
  };

  const [products, categories] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { name: "asc" },
      take: 100,
      include: { category: true, unit: true },
    }),
    prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  const preselect = params.productId ? [params.productId] : [];

  return (
    <div>
      <h1 className="text-base font-semibold text-slate-800 mb-5">Barcode Labels</h1>
      <BarcodePrintPanel products={products} categories={categories} preselect={preselect} />
    </div>
  );
}
