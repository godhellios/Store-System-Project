import { prisma } from "@/lib/prisma";
import { ProductForm } from "@/components/product-form";
import { notFound } from "next/navigation";
import { blockOperator } from "@/lib/role-guard";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  await blockOperator();
  const { id } = await params;

  const [product, categories, units] = await Promise.all([
    prisma.product.findUnique({ where: { id }, include: { category: true, unit: true, unitConversions: true } }),
    prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.unit.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  if (!product) notFound();

  return (
    <div>
      <h1 className="text-base font-semibold text-slate-800 mb-5">Edit Product</h1>
      <ProductForm categories={categories} units={units} product={product} />
    </div>
  );
}
