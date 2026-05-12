import { prisma } from "@/lib/prisma";
import Link from "next/link";
import RecentOrdersTable from "@/components/recent-orders-table";
import { getT } from "@/modules/i18n";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

async function getDashboardData() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [totalProducts, grnsToday, ordersOutToday, recentOrders, locationStock, allStock] =
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
        include: {
          lines: { include: { product: { include: { category: true } } } },
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
      prisma.stock.findMany({
        where: { product: { isActive: true } },
        select: { quantity: true, product: { select: { reorderPoint: true } } },
      }),
    ]);

  const lowStockCount = allStock.filter(
    (s) => s.product.reorderPoint > 0 && s.quantity <= s.product.reorderPoint
  ).length;

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
  const [pendingCount, pendingGrnCount, pendingGoodsOutCount, pendingTransferCount] = isAdmin
    ? await Promise.all([
        prisma.product.count({ where: { OR: [{ approvalStatus: "DRAFT" }, { pendingChangedAt: { not: null } }] } }),
        prisma.order.count({ where: { type: "GRN", grnStatus: "PENDING" } }),
        prisma.order.count({ where: { type: "GOODS_OUT", goodsOutStatus: "PENDING" } }),
        prisma.order.count({ where: { type: "TRANSFER", transferStatus: "PENDING" } }),
      ])
    : [0, 0, 0, 0];

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label={t("dashboard.totalProducts", "Total Products")} value={data.totalProducts} sub={t("dashboard.allLocations", "All locations")} color="border-sky-400" />
        <StatCard label={t("dashboard.grnsToday", "GRNs Today")} value={data.grnsToday} sub={t("dashboard.receivedToday", "Received today")} color="border-green-500" />
        <StatCard label={t("dashboard.ordersOutToday", "Orders Out Today")} value={data.ordersOutToday} sub={t("dashboard.issuedToday", "Issued today")} color="border-orange-400" />
        <StatCard label={t("dashboard.lowStockAlerts", "Low Stock Alerts")} value={data.lowStockCount} sub={t("dashboard.belowReorderPoint", "Below reorder point")} color="border-red-400" valueClass={data.lowStockCount > 0 ? "text-red-600 dark:text-red-400" : ""} />
      </div>
      {isAdmin && pendingGrnCount > 0 && (
        <Link href="/orders?type=GRN" className="block mb-3">
          <div className="bg-green-50 border border-green-300 border-l-4 border-l-green-600 rounded-xl p-4 flex items-center justify-between hover:bg-green-100 transition-colors">
            <div>
              <div className="text-sm font-semibold text-green-800">{pendingGrnCount} GRN{pendingGrnCount !== 1 ? "s" : ""} awaiting approval</div>
              <div className="text-xs text-green-700 mt-0.5">Stock will not be credited until you approve</div>
            </div>
            <span className="text-green-600 text-lg">📥</span>
          </div>
        </Link>
      )}
      {isAdmin && pendingGoodsOutCount > 0 && (
        <Link href="/orders?type=GOODS_OUT" className="block mb-3">
          <div className="bg-orange-50 border border-orange-300 border-l-4 border-l-orange-500 rounded-xl p-4 flex items-center justify-between hover:bg-orange-100 transition-colors">
            <div>
              <div className="text-sm font-semibold text-orange-800">{pendingGoodsOutCount} Goods Out{pendingGoodsOutCount !== 1 ? "" : ""} awaiting approval</div>
              <div className="text-xs text-orange-700 mt-0.5">Stock will not be deducted until you approve</div>
            </div>
            <span className="text-orange-500 text-lg">🚚</span>
          </div>
        </Link>
      )}
      {isAdmin && pendingTransferCount > 0 && (
        <Link href="/orders?type=TRANSFER" className="block mb-3">
          <div className="bg-blue-50 border border-blue-300 border-l-4 border-l-blue-500 rounded-xl p-4 flex items-center justify-between hover:bg-blue-100 transition-colors">
            <div>
              <div className="text-sm font-semibold text-blue-800">{pendingTransferCount} Transfer{pendingTransferCount !== 1 ? "s" : ""} awaiting approval</div>
              <div className="text-xs text-blue-700 mt-0.5">Stock will not be moved until you approve</div>
            </div>
            <span className="text-blue-500 text-lg">🔄</span>
          </div>
        </Link>
      )}
      {isAdmin && pendingCount > 0 && (
        <Link href="/products/pending" className="block mb-6">
          <div className="bg-amber-50 border border-amber-300 border-l-4 border-l-amber-500 rounded-xl p-4 flex items-center justify-between hover:bg-amber-100 transition-colors">
            <div>
              <div className="text-sm font-semibold text-amber-800">{pendingCount} product{pendingCount !== 1 ? "s" : ""} awaiting approval</div>
              <div className="text-xs text-amber-600 mt-0.5">Click to review and approve pending submissions</div>
            </div>
            <span className="text-amber-500 text-lg">⏳</span>
          </div>
        </Link>
      )}

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
        <RecentOrdersTable orders={data.recentOrders} />
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
