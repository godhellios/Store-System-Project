import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { AdjustmentClient } from "./_client";

export default async function AdjustmentPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const [locations, pendingOrders] = await Promise.all([
    prisma.location.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.order.findMany({
      where: { type: "ADJUSTMENT", adjustmentStatus: "PENDING" },
      orderBy: { createdAt: "desc" },
      include: {
        toLocation: true,
        lines: { include: { product: { select: { name: true, sku: true } } } },
      },
    }),
  ]);

  return (
    <div>
      <h1 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-5">
        Stock Adjustment
      </h1>
      <AdjustmentClient
        locations={locations}
        pendingOrders={pendingOrders}
        role={session.user.role}
        userName={session.user.name ?? ""}
      />
    </div>
  );
}
