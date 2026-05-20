import { prisma } from "@/lib/prisma";
import Link from "next/link";
import RecentOrdersTable from "@/components/recent-orders-table";
import { getT } from "@/modules/i18n";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

async function getDashboardData() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [totalProducts, grnsToday, ordersOutToday, recentOrders, locationStock, lowStockResult] =
    await Promise.all([
      prisma.product.count({ where: { isActive: true } }),
      prisma.order.count({
        where: { type: "GRN", createdAt: { gte: today } },
      }),
      prisma.order.count({
        where: { type: "GOODS_OUT", createdAt: { gte: today } },
      }),
      prisma.order.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          orderNumber: true,
          type: true,
          createdAt: true,
          lines: {
            select: {
              quantity: true,
              product: { select: { category: { select: { name: true } } } },
            },
          },
        },
      }),
      prisma.location.findMany({
        where: { isActive: true },
        include: {
          stock: {
            where: { product: { isActive: true, reorderPoint: { gt: 0 } } },
            include: { product: { include: { unit: true } } },
            orderBy: { quantity: "asc" },
          },
        },
      }),
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) AS count
        FROM "Stock" s
        JOIN "Product" p ON s."productId" = p.id
        WHERE p."isActive" = true
          AND p."reorderPoint" > 0
          AND s.quantity <= p."reorderPoint"
      `,
    ]);

  const lowStockCount = Number(lowStockResult[0].count);

  return {
    totalProducts,
    grnsToday,
    ordersOutToday,
    lowStockCount,
    recentOrders,
    locationStock,
  };
}

const LOC_HEADER: Record<string, string> = {
  "Retail Store": "bg-blue-600",
  "Medium Warehouse": "bg-cyan-700",
  "Big Warehouse": "bg-slate-800",
};

export default async function DashboardPage() {
  const [data, t, session] = await Promise.all([getDashboardData(), getT(), getServerSession(authOptions)]);
  const isAdmin = session?.user.role === "ADMIN";
  const [pendingCount, pendingGrnCount, pendingGoodsOutCount, pendingTransferCount, pendingAdjustmentCount] = isAdmin
    ? await Promise.all([
        prisma.product.count({ where: { OR: [{ approvalStatus: "DRAFT" }, { pendingChangedAt: { not: null } }] } }),
        prisma.order.count({ where: { type: "GRN", grnStatus: "PENDING" } }),
        prisma.order.count({ where: { type: "GOODS_OUT", goodsOutStatus: "PENDING" } }),
        prisma.order.count({ where: { type: "TRANSFER", transferStatus: "PENDING" } }),
        prisma.order.count({ where: { type: "ADJUSTMENT", adjustmentStatus: "PENDING" } }),
      ])
    : [0, 0, 0, 0, 0];

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label={t("dashboard.totalProducts", "Total Products")} value={data.totalProducts} sub={t("dashboard.allLocations", "All locations")} color="border-sky-400" />
        <StatCard label={t("dashboard.grnsToday", "GRNs Today")} value={data.grnsToday} sub={t("dashboard.receivedToday", "Received today")} color="border-green-500" />
        <StatCard label={t("dashboard.ordersOutToday", "Orders Out Today")} value={data.ordersOutToday} sub={t("dashboard.issuedToday", "Issued today")} color="border-orange-400" />
        <StatCard label={t("dashboard.lowStockAlerts", "Low Stock Alerts")} value={data.lowStockCount} sub={t("dashboard.belowReorderPoint", "Below reorder point")} color="border-red-400" valueClass={data.lowStockCount > 0 ? "text-red-600 dark:text-red-400" : ""} />
      </div>
      {isAdmin && (pendingCount + pendingGrnCount + pendingGoodsOutCount + pendingTransferCount + pendingAdjustmentCount) > 0 && (() => {
        const orderTotal = pendingGrnCount + pendingGoodsOutCount + pendingTransferCount + pendingAdjustmentCount;
        return (
          <div className="bg-amber-50 border border-amber-300 border-l-4 border-l-amber-500 rounded-xl mb-6 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-amber-200 flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-amber-700">Pending Approval</span>
              <span className="bg-amber-400 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {pendingCount + orderTotal}
              </span>
            </div>
            {orderTotal > 0 && (
              <Link href="/orders/pending" className="flex items-center justify-between px-4 py-3 hover:bg-amber-100 transition-colors border-b border-amber-100 last:border-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm font-medium text-amber-800">
                    {orderTotal} order{orderTotal !== 1 ? "s" : ""}
                  </span>
                  <div className="flex items-center gap-2 flex-wrap">
                    {pendingGrnCount > 0 && <span className="text-[11px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">GRN ×{pendingGrnCount}</span>}
                    {pendingGoodsOutCount > 0 && <span className="text-[11px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-medium">Goods Out ×{pendingGoodsOutCount}</span>}
                    {pendingTransferCount > 0 && <span className="text-[11px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">Transfer ×{pendingTransferCount}</span>}
                    {pendingAdjustmentCount > 0 && <span className="text-[11px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-medium">Adjustment ×{pendingAdjustmentCount}</span>}
                  </div>
                </div>
                <span className="text-amber-500 text-xs font-semibold whitespace-nowrap ml-3">Review →</span>
              </Link>
            )}
            {pendingCount > 0 && (
              <Link href="/products/pending" className="flex items-center justify-between px-4 py-3 hover:bg-amber-100 transition-colors">
                <span className="text-sm font-medium text-amber-800">
                  {pendingCount} product{pendingCount !== 1 ? "s" : ""}
                </span>
                <span className="text-amber-500 text-xs font-semibold whitespace-nowrap ml-3">Review →</span>
              </Link>
            )}
          </div>
        );
      })()}

      {/* Low stock by location */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-700">{t("dashboard.lowStockByLocation", "Low Stock Alerts by Location")}</h2>
        <Link href="/products?lowStock=1" className="text-xs text-blue-600 hover:underline">{t("dashboard.viewAllLowStock", "View all low stock →")}</Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {data.locationStock.map((loc) => {
          const lowItems = loc.stock.filter((s) => s.quantity <= s.product.reorderPoint);
          return (
            <div key={loc.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className={`px-4 py-3 text-white text-sm font-semibold flex items-center justify-between ${LOC_HEADER[loc.name] ?? "bg-slate-600"}`}>
                <span>{loc.name}</span>
                {lowItems.length > 0 && (
                  <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{lowItems.length}</span>
                )}
              </div>
              {lowItems.length === 0 ? (
                <p className="px-4 py-3 text-xs text-green-600 flex items-center gap-1.5">
                  <span>✓</span> {t("dashboard.allStockAbove", "All stock above reorder point")}
                </p>
              ) : (
                lowItems.map((s) => (
                  <div key={s.id} className="flex justify-between items-center px-4 py-2.5 border-b border-slate-50 last:border-0 text-sm">
                    <div className="truncate mr-2">
                      <div className="text-slate-700 text-xs font-medium truncate">{s.product.name}</div>
                      <div className="text-[11px] text-slate-400">{t("dashboard.reorderAt", "reorder at")} {s.product.reorderPoint}</div>
                    </div>
                    <span className="font-semibold text-red-500 dark:text-red-400 whitespace-nowrap text-xs">
                      {s.quantity} {s.product.unit?.name?.toLowerCase() ?? ""} ⚠
                    </span>
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>

      {/* Recent orders */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-700">{t("dashboard.recentOrders", "Recent Orders")}</h2>
        <Link href="/orders" className="text-xs text-blue-600 hover:underline">{t("dashboard.viewAll", "View all →")}</Link>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <RecentOrdersTable orders={data.recentOrders.map((o) => ({ ...o, createdAt: o.createdAt.toISOString() }))} />
      </div>
    </div>
  );
}

function StatCard({
  label, value, sub, color, valueClass = "",
}: {
  label: string;
  value: number;
  sub: string;
  color: string;
  valueClass?: string;
}) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 border-l-4 ${color} p-4`}>
      <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold text-slate-800 ${valueClass}`}>{value}</div>
      <div className="text-[11px] text-slate-400 mt-1">{sub}</div>
    </div>
  );
}
