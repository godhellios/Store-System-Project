import { prisma } from "@/lib/prisma";
import { ProductForm } from "@/components/product-form";
import { blockViewer, blockOperator } from "@/lib/role-guard";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export default async function AddProductPage() {
  const [session, categories, units] = await Promise.all([
    getServerSession(authOptions),
    prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    // parentUnitId + conversionFactor drive the packing-unit dropdown.
    prisma.unit.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, isActive: true, parentUnitId: true, conversionFactor: true },
    }),
  ]);
  await blockViewer();
  await blockOperator();
  const isAdmin = session?.user.role === "ADMIN";

  return (
    <div>
      <h1 className="text-base font-semibold text-slate-800 mb-5">Add Product</h1>
      <ProductForm
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        units={units}
        isAdmin={isAdmin}
      />
    </div>
  );
}
