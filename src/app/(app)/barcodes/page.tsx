import { prisma } from "@/lib/prisma";
import { BarcodePrintPanel } from "@/components/barcode-print-panel";
import { blockOperator } from "@/lib/role-guard";

export default async function BarcodesPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string }>;
}) {
  await blockOperator();
  const { productId } = await searchParams;

  const [products, categories, preselectProduct] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      include: { category: true, unit: true, unitConversions: true },
    }),
    prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    productId
      ? prisma.product.findUnique({
          where: { id: productId },
          include: { category: true, unit: true, unitConversions: true },
        })
      : Promise.resolve(null),
  ]);

  // Ensure the linked product is in the list even if it was somehow excluded
  const mergedProducts =
    preselectProduct && !products.some((p) => p.id === preselectProduct.id)
      ? [preselectProduct, ...products]
      : products;

  const preselect = productId ? [productId] : [];

  return (
    <div>
      <h1 className="text-base font-semibold text-slate-800 mb-5">Barcode Labels</h1>
      <BarcodePrintPanel products={mergedProducts} categories={categories} preselect={preselect} />
    </div>
  );
}
