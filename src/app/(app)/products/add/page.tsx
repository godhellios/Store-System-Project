import { prisma } from "@/lib/prisma";
import { ProductForm } from "@/components/product-form";
import { blockOperator } from "@/lib/role-guard";

export default async function AddProductPage() {
  await blockOperator();
  const [categories, units] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.unit.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div>
      <h1 className="text-base font-semibold text-slate-800 mb-5">Add Product</h1>
      <ProductForm categories={categories} units={units} />
    </div>
  );
}
