import { prisma } from "@/lib/prisma";
import { ProductForm } from "@/components/product-form";
import { notFound } from "next/navigation";
import { blockOperator } from "@/lib/role-guard";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const [session] = await Promise.all([getServerSession(authOptions)]);
  await blockOperator();
  const { id } = await params;

  const [product, categories, units] = await Promise.all([
    prisma.product.findUnique({ where: { id }, include: { category: true, unit: true, unitConversions: true } }),
    prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.unit.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  if (!product) notFound();
  const isAdmin = session?.user.role === "ADMIN";

  return (
    <div>
      <h1 className="text-base font-semibold text-slate-800 mb-5">Edit Product</h1>
      <ProductForm categories={categories} units={units} product={product} isAdmin={isAdmin} />
    </div>
  );
}
