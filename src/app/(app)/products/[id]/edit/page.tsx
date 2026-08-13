import { prisma } from "@/lib/prisma";
import { ProductForm } from "@/components/product-form";
import { notFound } from "next/navigation";
import { blockViewer, blockOperator } from "@/lib/role-guard";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  await blockViewer();
  const [session] = await Promise.all([getServerSession(authOptions)]);
  await blockOperator();
  const { id } = await params;

  const [product, categories, units] = await Promise.all([
    prisma.product.findUnique({
      where: { id },
      select: {
        id: true, name: true, sku: true, barcode: true,
        categoryId: true, unitId: true, reorderPoint: true,
        colorVariant: true, description: true, imageUrl: true,
        pendingChanges: true, pendingChangedBy: true, pendingChangedAt: true,
        category: { select: { id: true, name: true } },
        unit: { select: { id: true, name: true } },
        unitConversions: { select: { id: true, unitId: true, barcode: true } },
      },
    }),
    prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    // parentUnitId + conversionFactor let the form show only the packing units
    // that belong to the chosen base unit, with their factor read-only.
    prisma.unit.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, isActive: true, parentUnitId: true, conversionFactor: true },
    }),
  ]);

  if (!product) notFound();
  const isAdmin = session?.user.role === "ADMIN";

  return (
    <div>
      <h1 className="text-base font-semibold text-slate-800 mb-5">Edit Product</h1>
      <ProductForm
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        units={units}
        product={{ ...product, pendingChangedAt: product.pendingChangedAt?.toISOString() ?? null }}
        isAdmin={isAdmin}
      />
    </div>
  );
}
