import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { AdjustmentClient } from "./_client";
import { getT } from "@/modules/i18n";

export default async function AdjustmentPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const [locations, pendingOrders, t] = await Promise.all([
    prisma.location.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.order.findMany({
      where: { type: "ADJUSTMENT", adjustmentStatus: "PENDING" },
      orderBy: { createdAt: "desc" },
      include: {
        toLocation: true,
        lines: { select: { quantity: true, product: { select: { name: true, sku: true } } } },
      },
    }),
    getT(),
  ]);

  return (
    <div>
      <h1 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-5">
        {t("transactions.adjustment", "Stock Adjustment")}
      </h1>
      <AdjustmentClient
        locations={locations.map((l) => ({ id: l.id, name: l.name }))}
        pendingOrders={pendingOrders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          createdAt: o.createdAt.toISOString(),
          createdByName: o.createdByName,
          adjustmentReason: o.adjustmentReason,
          notes: o.notes,
          toLocation: o.toLocation ? { name: o.toLocation.name } : null,
          lines: o.lines,
        }))}
        role={session.user.role}
        userName={session.user.name ?? ""}
      />
    </div>
  );
}
