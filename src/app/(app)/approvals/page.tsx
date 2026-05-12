import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PendingOrdersList } from "@/components/pending-orders-list";

export default async function ApprovalsPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/dashboard");

  const pendingProducts = await prisma.product.findMany({
    where: { OR: [{ approvalStatus: "DRAFT" }, { pendingChangedAt: { not: null } }] },
    select: { id: true, name: true, sku: true, approvalStatus: true, pendingChangedAt: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div>
      <h1 className="text-base font-semibold text-slate-800 mb-5">Pending Approvals</h1>

      {/* Products section */}
      {pendingProducts.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-700">Products</h2>
              <span className="bg-amber-100 text-amber-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                {pendingProducts.length}
              </span>
            </div>
            <Link href="/products/pending" className="text-xs text-blue-600 hover:underline">
              Review all →
            </Link>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            {pendingProducts.map((p, i) => (
              <Link
                key={p.id}
                href="/products/pending"
                className={`flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors${i > 0 ? " border-t border-slate-100" : ""}`}
              >
                <div className="min-w-0 mr-3">
                  <div className="text-sm font-medium text-slate-700 truncate">{p.name}</div>
                  <div className="text-xs font-mono text-slate-400">{p.sku}</div>
                </div>
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                  p.pendingChangedAt ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
                }`}>
                  {p.pendingChangedAt ? "Edit" : "New"}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Orders section */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-semibold text-slate-700">Orders</h2>
        </div>
        <PendingOrdersList />
      </div>
    </div>
  );
}
