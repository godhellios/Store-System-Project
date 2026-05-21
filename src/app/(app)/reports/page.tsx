"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { useT } from "@/modules/i18n/provider";

type Location = { id: string; name: string };
type Category = { id: string; name: string };
type StockRow = { id: string; quantity: number; product: { name: string; sku: string; reorderPoint: number; category: { name: string }; unit: { name: string } }; location: { name: string } };
type MovementRow = { id: string; quantity: number; type: string; createdAt: string; product: { name: string; unit: { name: string } }; fromLocation: { name: string } | null; toLocation: { name: string } | null; order: { orderNumber: string } | null; orderId: string };
type ReceivingReport = {
  overview: { totalGrns: number; totalUnits: number; totalValue: number | null };
  bySupplier: { name: string; grns: number; units: number; value: number }[];
  byCategory: { name: string; grns: number; units: number; value: number }[];
  orders: { id: string; orderNumber: string; createdAt: string; supplier: string | null; location: string | null; itemCount: number; totalUnits: number; totalValue: number | null }[];
};
type InventoryValueReport = {
  overview: { totalValue: number; totalUnits: number; itemsWithCost: number; totalItems: number };
  byLocation: { name: string; units: number; value: number }[];
  byCategory: { name: string; units: number; value: number }[];
  monthlyIn: { month: string; value: number }[];
  topItems: { name: string; sku: string; location: string; qty: number; unit: string; avgCost: number; value: number }[];
};
type TurnoverReport = {
  rows: { name: string; sku: string; category: string; unit: string; moves: number; totalOut: number; currentStock: number; avgDailyOut: number; daysOfStock: number | null }[];
  dayRange: number;
};

export default function ReportsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const t = useT();

  useEffect(() => {
    if (session?.user.role === "OPERATOR") router.replace("/transactions/grn");
  }, [session, router]);

  const isAdmin = session?.user.role === "ADMIN" || session?.user.role === "VIEWER";

  const TABS = [
    t("reports.tabs.stockOnHand", "Stock On Hand"),
    t("reports.tabs.movementLog", "Movement Log"),
    t("reports.tabs.lowStock", "Low Stock"),
    t("reports.tabs.receiving", "Penerimaan"),
    ...(isAdmin ? ["Inventory Value"] : []),
    "Turnover",
  ];

  const [tab, setTab] = useState(0);
  const [locations, setLocations] = useState<Location[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [receivingData, setReceivingData] = useState<ReceivingReport | null>(null);
  const [inventoryValueData, setInventoryValueData] = useState<InventoryValueReport | null>(null);
  const [turnoverData, setTurnoverData] = useState<TurnoverReport | null>(null);

  const [locationId, setLocationId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const [data, setData] = useState<StockRow[] | MovementRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/locations").then((r) => r.json()),
      fetch("/api/categories").then((r) => r.json()),
    ]).then(([locs, cats]) => { setLocations(locs); setCategories(cats); });
  }, []);

  // Tab indices depend on isAdmin (inventory-value tab only shown to admins)
  const TAB_REPORTS = isAdmin
    ? ["stock", "movements", "low-stock", "receiving", "inventory-value", "turnover"]
    : ["stock", "movements", "low-stock", "receiving", "turnover"];

  async function fetchData() {
    setLoading(true);
    const report = TAB_REPORTS[tab] ?? "stock";
    const qs = new URLSearchParams({ report, locationId, categoryId, from, to });
    const res = await fetch(`/api/reports?${qs}`);
    if (!res.ok) { toast.error("Failed to load report"); setLoading(false); return; }
    const json = await res.json();
    if (report === "receiving") { setReceivingData(json); setInventoryValueData(null); setTurnoverData(null); setData([]); }
    else if (report === "inventory-value") { setInventoryValueData(json); setReceivingData(null); setTurnoverData(null); setData([]); }
    else if (report === "turnover") { setTurnoverData(json); setReceivingData(null); setInventoryValueData(null); setData([]); }
    else { setData(json); setReceivingData(null); setInventoryValueData(null); setTurnoverData(null); }
    setLoading(false);
  }

  function exportExcel() {
    const report = TAB_REPORTS[tab] ?? "stock";
    const qs = new URLSearchParams({ report, format: "xlsx", locationId, categoryId, from, to });
    window.location.href = `/api/reports?${qs}`;
  }

  useEffect(() => { fetchData(); }, [tab]);

  const stockData = data as StockRow[];
  const movData = data as MovementRow[];

  const MOVE_BADGE: Record<string, string> = {
    IN: "bg-green-100 text-green-700", OUT: "bg-orange-100 text-orange-700",
    TRANSFER: "bg-blue-100 text-blue-700", ADJUSTMENT: "bg-gray-100 text-gray-600",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-base font-semibold text-slate-800">{t("reports.title", "Reports")}</h1>
        <button onClick={exportExcel} className="text-xs px-3 py-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
          {t("common.exportExcel", "↓ Export Excel")}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-slate-200">
        {TABS.map((tabLabel, i) => (
          <button key={tabLabel} onClick={() => { setTab(i); setData([]); }}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${i === tab ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            {tabLabel}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4 flex-wrap items-end">
        <div>
          <label className="text-xs text-slate-500 block mb-1">{t("reports.filters.location", "Location")}</label>
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">{t("products.allLocations", "All Locations")}</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">{t("reports.filters.category", "Category")}</label>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">{t("products.allCategories", "All Categories")}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {["movements", "receiving", "turnover"].includes(TAB_REPORTS[tab]) && <>
          <div>
            <label className="text-xs text-slate-500 block mb-1">{t("reports.filters.from", "From")}</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">{t("reports.filters.to", "To")}</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          </div>
        </>}
        <button onClick={fetchData}
          className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 self-end">
          {t("reports.filters.apply", "Apply")}
        </button>
      </div>

      {/* Receiving Summary Tab */}
      {TAB_REPORTS[tab] === "receiving" && !loading && receivingData && (
        <div className="space-y-4">
          {/* Overview cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-400 mb-1">Total GRN</div>
              <div className="text-2xl font-bold text-slate-800">{receivingData.overview.totalGrns}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-400 mb-1">Total Units Received</div>
              <div className="text-2xl font-bold text-slate-800">{receivingData.overview.totalUnits.toLocaleString("id-ID")}</div>
            </div>
            {isAdmin && (
              <div className="bg-slate-800 rounded-xl p-4 col-span-2 sm:col-span-1">
                <div className="text-xs text-slate-300 mb-1">Total Value (Admin)</div>
                <div className="text-2xl font-bold text-white">
                  {receivingData.overview.totalValue != null && receivingData.overview.totalValue > 0
                    ? `Rp ${receivingData.overview.totalValue.toLocaleString("id-ID")}`
                    : <span className="text-slate-400 text-lg">No cost data</span>}
                </div>
              </div>
            )}
          </div>

          {/* By Supplier */}
          {receivingData.bySupplier.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">By Supplier</div>
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-slate-400 uppercase border-b border-slate-100">
                  <th className="px-4 py-2 text-left font-medium">Supplier</th>
                  <th className="px-4 py-2 text-right font-medium">GRNs</th>
                  <th className="px-4 py-2 text-right font-medium">Units</th>
                  {isAdmin && <th className="px-4 py-2 text-right font-medium">Value</th>}
                </tr></thead>
                <tbody>
                  {receivingData.bySupplier.map((s) => (
                    <tr key={s.name} className="border-t border-slate-50">
                      <td className="px-4 py-2.5 font-medium text-slate-700">{s.name}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500">{s.grns}</td>
                      <td className="px-4 py-2.5 text-right text-slate-700">{s.units.toLocaleString("id-ID")}</td>
                      {isAdmin && <td className="px-4 py-2.5 text-right text-slate-700">{s.value > 0 ? `Rp ${s.value.toLocaleString("id-ID")}` : "—"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* By Category */}
          {receivingData.byCategory.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">By Category</div>
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-slate-400 uppercase border-b border-slate-100">
                  <th className="px-4 py-2 text-left font-medium">Category</th>
                  <th className="px-4 py-2 text-right font-medium">GRNs</th>
                  <th className="px-4 py-2 text-right font-medium">Units</th>
                  {isAdmin && <th className="px-4 py-2 text-right font-medium">Value</th>}
                </tr></thead>
                <tbody>
                  {receivingData.byCategory.map((c) => (
                    <tr key={c.name} className="border-t border-slate-50">
                      <td className="px-4 py-2.5 font-medium text-slate-700">{c.name}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500">{c.grns}</td>
                      <td className="px-4 py-2.5 text-right text-slate-700">{c.units.toLocaleString("id-ID")}</td>
                      {isAdmin && <td className="px-4 py-2.5 text-right text-slate-700">{c.value > 0 ? `Rp ${c.value.toLocaleString("id-ID")}` : "—"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* GRN list */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">GRN List</div>
            {receivingData.orders.length === 0 ? (
              <p className="text-center py-8 text-sm text-slate-400">No approved GRNs in this period.</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-slate-400 uppercase border-b border-slate-100">
                  <th className="px-4 py-2 text-left font-medium">Date</th>
                  <th className="px-4 py-2 text-left font-medium">GRN No.</th>
                  <th className="px-4 py-2 text-left font-medium">Supplier</th>
                  <th className="px-4 py-2 text-left font-medium">Location</th>
                  <th className="px-4 py-2 text-right font-medium">Units</th>
                  {isAdmin && <th className="px-4 py-2 text-right font-medium">Value</th>}
                </tr></thead>
                <tbody>
                  {receivingData.orders.map((o) => (
                    <tr key={o.id} className="border-t border-slate-50 hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-xs text-slate-500">
                        {new Date(o.createdAt).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}
                      </td>
                      <td className="px-4 py-2.5">
                        <a href={`/orders/${o.id}`} className="text-blue-600 hover:underline font-mono text-xs">{o.orderNumber}</a>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{o.supplier ?? <span className="text-slate-300">—</span>}</td>
                      <td className="px-4 py-2.5 text-slate-600">{o.location ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right text-slate-700">{o.totalUnits.toLocaleString("id-ID")}</td>
                      {isAdmin && <td className="px-4 py-2.5 text-right text-slate-700">{o.totalValue != null && o.totalValue > 0 ? `Rp ${o.totalValue.toLocaleString("id-ID")}` : "—"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
      {/* Inventory Value Tab */}
      {TAB_REPORTS[tab] === "inventory-value" && !loading && inventoryValueData && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-800 rounded-xl p-4 col-span-2">
              <div className="text-xs text-slate-300 mb-1">Total Inventory Value</div>
              <div className="text-2xl font-bold text-white">Rp {inventoryValueData.overview.totalValue.toLocaleString("id-ID")}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-400 mb-1">Total Units</div>
              <div className="text-2xl font-bold text-slate-800">{inventoryValueData.overview.totalUnits.toLocaleString("id-ID")}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-400 mb-1">Items with Cost Data</div>
              <div className="text-2xl font-bold text-slate-800">{inventoryValueData.overview.itemsWithCost}<span className="text-sm font-normal text-slate-400"> / {inventoryValueData.overview.totalItems}</span></div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">By Location</div>
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-slate-400 uppercase border-b border-slate-100">
                  <th className="px-4 py-2 text-left font-medium">Location</th>
                  <th className="px-4 py-2 text-right font-medium">Value</th>
                </tr></thead>
                <tbody>
                  {inventoryValueData.byLocation.map((l) => (
                    <tr key={l.name} className="border-t border-slate-50">
                      <td className="px-4 py-2.5 font-medium text-slate-700">{l.name}</td>
                      <td className="px-4 py-2.5 text-right text-slate-700">{l.value > 0 ? `Rp ${l.value.toLocaleString("id-ID")}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">By Category</div>
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-slate-400 uppercase border-b border-slate-100">
                  <th className="px-4 py-2 text-left font-medium">Category</th>
                  <th className="px-4 py-2 text-right font-medium">Value</th>
                </tr></thead>
                <tbody>
                  {inventoryValueData.byCategory.map((c) => (
                    <tr key={c.name} className="border-t border-slate-50">
                      <td className="px-4 py-2.5 font-medium text-slate-700">{c.name}</td>
                      <td className="px-4 py-2.5 text-right text-slate-700">{c.value > 0 ? `Rp ${c.value.toLocaleString("id-ID")}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {inventoryValueData.monthlyIn.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">Value Received per Month (last 12 months)</div>
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-slate-400 uppercase border-b border-slate-100">
                  <th className="px-4 py-2 text-left font-medium">Month</th>
                  <th className="px-4 py-2 text-right font-medium">Value Received</th>
                </tr></thead>
                <tbody>
                  {inventoryValueData.monthlyIn.map((m) => (
                    <tr key={m.month} className="border-t border-slate-50">
                      <td className="px-4 py-2.5 font-medium text-slate-700">{m.month}</td>
                      <td className="px-4 py-2.5 text-right text-slate-700">{m.value > 0 ? `Rp ${m.value.toLocaleString("id-ID")}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">Top Items by Value</div>
            {inventoryValueData.topItems.length === 0 ? (
              <p className="text-center py-8 text-sm text-slate-400">No items with cost data yet. Enter unit costs when approving GRNs.</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-slate-400 uppercase border-b border-slate-100">
                  <th className="px-4 py-2 text-left font-medium">Product</th>
                  <th className="px-4 py-2 text-left font-medium">Location</th>
                  <th className="px-4 py-2 text-right font-medium">Qty</th>
                  <th className="px-4 py-2 text-right font-medium">Avg Cost</th>
                  <th className="px-4 py-2 text-right font-medium">Value</th>
                </tr></thead>
                <tbody>
                  {inventoryValueData.topItems.map((item, i) => (
                    <tr key={i} className="border-t border-slate-50 hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-slate-800">{item.name}</div>
                        <div className="text-xs font-mono text-slate-400">{item.sku}</div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs">{item.location}</td>
                      <td className="px-4 py-2.5 text-right text-slate-700">{item.qty.toLocaleString("id-ID")} <span className="text-xs text-slate-400">{item.unit}</span></td>
                      <td className="px-4 py-2.5 text-right text-slate-500 text-xs">Rp {item.avgCost.toLocaleString("id-ID")}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-slate-800">Rp {item.value.toLocaleString("id-ID")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Turnover Tab */}
      {TAB_REPORTS[tab] === "turnover" && !loading && turnoverData && (
        <div className="space-y-4">
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-600">
            Showing outbound movements over <span className="font-semibold">{turnoverData.dayRange} days</span>. Fast movers first.
          </div>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                    <th className="px-4 py-2.5 text-left font-medium">Product</th>
                    <th className="px-4 py-2.5 text-left font-medium">Category</th>
                    <th className="px-4 py-2.5 text-right font-medium">Total Out</th>
                    <th className="px-4 py-2.5 text-right font-medium">Avg/Day</th>
                    <th className="px-4 py-2.5 text-right font-medium">Current Stock</th>
                    <th className="px-4 py-2.5 text-right font-medium">Days of Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {turnoverData.rows.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400 text-xs">No outbound movements in this period.</td></tr>
                  ) : turnoverData.rows.map((r, i) => {
                    const urgency = r.daysOfStock != null && r.daysOfStock <= 7 ? "text-red-600 font-semibold" : r.daysOfStock != null && r.daysOfStock <= 30 ? "text-amber-600" : "text-slate-700";
                    return (
                      <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-slate-800">{r.name}</div>
                          <div className="text-xs font-mono text-slate-400">{r.sku}</div>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">{r.category}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{r.totalOut.toLocaleString("id-ID")} <span className="text-xs font-normal text-slate-400">{r.unit}</span></td>
                        <td className="px-4 py-2.5 text-right text-slate-600">{r.avgDailyOut}</td>
                        <td className="px-4 py-2.5 text-right text-slate-700">{r.currentStock.toLocaleString("id-ID")}</td>
                        <td className={`px-4 py-2.5 text-right ${urgency}`}>{r.daysOfStock != null ? `${r.daysOfStock}d` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {loading && ["receiving", "inventory-value", "turnover"].includes(TAB_REPORTS[tab]) && (
        <div className="text-center py-12 text-slate-400 text-sm">{t("common.loading", "Loading…")}</div>
      )}

      {!["receiving", "inventory-value", "turnover"].includes(TAB_REPORTS[tab]) && loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">{t("common.loading", "Loading…")}</div>
      ) : !["receiving", "inventory-value", "turnover"].includes(TAB_REPORTS[tab]) && (
        <>
          {/* Mobile card lists */}
          <div className="md:hidden space-y-2">
            {tab !== 1 && (
              stockData.length === 0 ? (
                <p className="text-center text-xs text-slate-400 py-10">{t("reports.noData", "No data")}</p>
              ) : stockData.map((s) => {
                const isLow = s.product.reorderPoint > 0 && s.quantity <= s.product.reorderPoint;
                return (
                  <div key={s.id} className={`bg-white dark:bg-slate-800 rounded-xl border px-4 py-3 ${isLow ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40" : "border-slate-200 dark:border-slate-700"}`}>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="min-w-0">
                        <div className="font-medium text-sm text-slate-800 leading-tight">{s.product.name}</div>
                        <div className="text-xs font-mono text-slate-400 mt-0.5">{s.product.sku} · {s.product.category.name}</div>
                      </div>
                      <span className={`flex-shrink-0 font-semibold text-sm ${isLow ? "text-red-600 dark:text-red-400" : "text-slate-800 dark:text-slate-100"}`}>
                        {s.quantity}{isLow ? " ⚠" : ""} <span className="text-xs font-normal text-slate-500">{s.product.unit.name}</span>
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 flex gap-3 mt-1">
                      <span>{s.location.name}</span>
                      {s.product.reorderPoint > 0 && tab === 0 && <span className="text-slate-400">{t("reports.reorderAt", "reorder at")} {s.product.reorderPoint}</span>}
                      {tab === 2 && <span className="text-red-600 dark:text-red-400 font-medium">{t("reports.shortfall", "shortfall")}: {s.product.reorderPoint - s.quantity}</span>}
                    </div>
                  </div>
                );
              })
            )}
            {tab === 1 && (
              movData.length === 0 ? (
                <p className="text-center text-xs text-slate-400 py-10">{t("reports.noMovements", "No movements in range")}</p>
              ) : movData.map((m) => (
                <div key={m.id} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-mono text-xs text-blue-600">{m.order?.orderNumber ?? m.orderId.slice(0, 8) + "…"}</span>
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${MOVE_BADGE[m.type]}`}>{m.type}</span>
                  </div>
                  <div className="font-medium text-sm text-slate-800 mb-1">{m.product.name}</div>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>{m.fromLocation?.name ?? "—"} → {m.toLocation?.name ?? "—"}</span>
                    <span className="font-semibold text-slate-800">{m.quantity} <span className="font-normal text-slate-400">{m.product.unit.name}</span></span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1">{new Date(m.createdAt).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })}</div>
                </div>
              ))
            )}
          </div>

          {/* Desktop tables */}
          <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
            {/* Stock On Hand / Low Stock */}
            {tab !== 1 && (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                    {tab === 0 ? <>
                      <th className="px-4 py-2.5 text-left font-medium">{t("reports.cols.location", "Location")}</th>
                      <th className="px-4 py-2.5 text-left font-medium">{t("reports.cols.product", "Product")}</th>
                      <th className="px-4 py-2.5 text-left font-medium">{t("reports.cols.sku", "SKU")}</th>
                      <th className="px-4 py-2.5 text-left font-medium">{t("reports.cols.category", "Category")}</th>
                      <th className="px-4 py-2.5 text-right font-medium">{t("reports.cols.qty", "Qty")}</th>
                      <th className="px-4 py-2.5 text-left font-medium">{t("reports.cols.unit", "Unit")}</th>
                      <th className="px-4 py-2.5 text-right font-medium">{t("reports.cols.reorderPt", "Reorder Pt")}</th>
                    </> : <>
                      <th className="px-4 py-2.5 text-left font-medium">{t("reports.cols.product", "Product")}</th>
                      <th className="px-4 py-2.5 text-left font-medium">{t("reports.cols.location", "Location")}</th>
                      <th className="px-4 py-2.5 text-right font-medium">{t("reports.cols.currentQty", "Current Qty")}</th>
                      <th className="px-4 py-2.5 text-right font-medium">{t("reports.cols.reorderPt", "Reorder Pt")}</th>
                      <th className="px-4 py-2.5 text-right font-medium">{t("reports.cols.shortfall", "Shortfall")}</th>
                      <th className="px-4 py-2.5 text-left font-medium">{t("reports.cols.unit", "Unit")}</th>
                    </>}
                  </tr>
                </thead>
                <tbody>
                  {stockData.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400 text-xs">{t("reports.noData", "No data")}</td></tr>
                  ) : stockData.map((s) => {
                    const isLow = s.product.reorderPoint > 0 && s.quantity <= s.product.reorderPoint;
                    return (
                      <tr key={s.id} className={`border-t border-slate-100 hover:bg-slate-50 ${isLow ? "bg-red-50 dark:bg-red-950/40 hover:bg-red-50 dark:hover:bg-red-950/40" : ""}`}>
                        {tab === 0 ? <>
                          <td className="px-4 py-2.5 text-slate-600">{s.location.name}</td>
                          <td className="px-4 py-2.5 font-medium text-slate-800">{s.product.name}</td>
                          <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{s.product.sku}</td>
                          <td className="px-4 py-2.5 text-xs text-slate-500">{s.product.category.name}</td>
                          <td className={`px-4 py-2.5 text-right font-semibold ${isLow ? "text-red-600 dark:text-red-400" : "text-slate-800 dark:text-slate-100"}`}>{s.quantity}{isLow ? " ⚠" : ""}</td>
                          <td className="px-4 py-2.5 text-xs text-slate-500">{s.product.unit.name}</td>
                          <td className="px-4 py-2.5 text-right text-slate-500">{s.product.reorderPoint}</td>
                        </> : <>
                          <td className="px-4 py-2.5 font-medium text-slate-800">{s.product.name}</td>
                          <td className="px-4 py-2.5 text-slate-600">{s.location.name}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-red-600 dark:text-red-400">{s.quantity}</td>
                          <td className="px-4 py-2.5 text-right text-slate-500">{s.product.reorderPoint}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-red-700 dark:text-red-400">{s.product.reorderPoint - s.quantity}</td>
                          <td className="px-4 py-2.5 text-xs text-slate-500">{s.product.unit.name}</td>
                        </>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {/* Movements */}
            {tab === 1 && (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                    <th className="px-4 py-2.5 text-left font-medium">{t("reports.cols.date", "Date")}</th>
                    <th className="px-4 py-2.5 text-left font-medium">{t("reports.cols.order", "Order")}</th>
                    <th className="px-4 py-2.5 text-left font-medium">{t("reports.cols.type", "Type")}</th>
                    <th className="px-4 py-2.5 text-left font-medium">{t("reports.cols.product", "Product")}</th>
                    <th className="px-4 py-2.5 text-left font-medium">{t("reports.cols.from", "From")}</th>
                    <th className="px-4 py-2.5 text-left font-medium">{t("reports.cols.to", "To")}</th>
                    <th className="px-4 py-2.5 text-right font-medium">{t("reports.cols.qty", "Qty")}</th>
                  </tr>
                </thead>
                <tbody>
                  {movData.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400 text-xs">{t("reports.noMovements", "No movements in range")}</td></tr>
                  ) : movData.map((m) => (
                    <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-xs text-slate-500">{new Date(m.createdAt).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-blue-600">{m.order?.orderNumber ?? m.orderId.slice(0, 8) + "…"}</td>
                      <td className="px-4 py-2.5"><span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${MOVE_BADGE[m.type]}`}>{m.type}</span></td>
                      <td className="px-4 py-2.5 text-slate-800">{m.product.name}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">{m.fromLocation?.name ?? "—"}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">{m.toLocation?.name ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{m.quantity} <span className="text-slate-400 font-normal text-xs">{m.product.unit.name}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
