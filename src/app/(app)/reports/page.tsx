"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

type Location = { id: string; name: string };
type Category = { id: string; name: string };
type StockRow = { id: string; quantity: number; product: { name: string; sku: string; reorderPoint: number; category: { name: string }; unit: { name: string } }; location: { name: string } };
type MovementRow = { id: string; quantity: number; type: string; createdAt: string; product: { name: string; unit: { name: string } }; fromLocation: { name: string } | null; toLocation: { name: string } | null; order: { orderNumber: string } | null; orderId: string };

const TABS = ["Stock On Hand", "Movement Log", "Low Stock"];

export default function ReportsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (session?.user.role === "OPERATOR") router.replace("/transactions/grn");
  }, [session, router]);

  const [tab, setTab] = useState(0);
  const [locations, setLocations] = useState<Location[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const [locationId, setLocationId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [data, setData] = useState<StockRow[] | MovementRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/locations").then((r) => r.json()),
      fetch("/api/categories").then((r) => r.json()),
    ]).then(([locs, cats]) => { setLocations(locs); setCategories(cats); });
  }, []);

  async function fetchData() {
    setLoading(true);
    const report = tab === 0 ? "stock" : tab === 1 ? "movements" : "low-stock";
    const qs = new URLSearchParams({ report, locationId, categoryId, from, to });
    const res = await fetch(`/api/reports?${qs}`);
    if (!res.ok) { toast.error("Failed to load report"); setLoading(false); return; }
    setData(await res.json());
    setLoading(false);
  }

  function exportExcel() {
    const report = tab === 0 ? "stock" : tab === 1 ? "movements" : "low-stock";
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
        <h1 className="text-base font-semibold text-slate-800">Reports</h1>
        <button onClick={exportExcel} className="text-xs px-3 py-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
          ↓ Export Excel
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-slate-200">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => { setTab(i); setData([]); }}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${i === tab ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4 flex-wrap items-end">
        <div>
          <label className="text-xs text-slate-500 block mb-1">Location</label>
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All Locations</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">Category</label>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All Categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {tab === 1 && <>
          <div>
            <label className="text-xs text-slate-500 block mb-1">From</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">To</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          </div>
        </>}
        <button onClick={fetchData}
          className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 self-end">
          Apply
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
          {/* Stock On Hand */}
          {tab !== 1 && (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                  {tab === 0 ? <>
                    <th className="px-4 py-2.5 text-left font-medium">Location</th>
                    <th className="px-4 py-2.5 text-left font-medium">Product</th>
                    <th className="px-4 py-2.5 text-left font-medium">SKU</th>
                    <th className="px-4 py-2.5 text-left font-medium">Category</th>
                    <th className="px-4 py-2.5 text-right font-medium">Qty</th>
                    <th className="px-4 py-2.5 text-left font-medium">Unit</th>
                    <th className="px-4 py-2.5 text-right font-medium">Reorder Pt</th>
                  </> : <>
                    <th className="px-4 py-2.5 text-left font-medium">Product</th>
                    <th className="px-4 py-2.5 text-left font-medium">Location</th>
                    <th className="px-4 py-2.5 text-right font-medium">Current Qty</th>
                    <th className="px-4 py-2.5 text-right font-medium">Reorder Pt</th>
                    <th className="px-4 py-2.5 text-right font-medium">Shortfall</th>
                    <th className="px-4 py-2.5 text-left font-medium">Unit</th>
                  </>}
                </tr>
              </thead>
              <tbody>
                {stockData.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400 text-xs">No data</td></tr>
                ) : stockData.map((s) => {
                  const isLow = s.product.reorderPoint > 0 && s.quantity <= s.product.reorderPoint;
                  return (
                    <tr key={s.id} className={`border-t border-slate-100 hover:bg-slate-50 ${isLow ? "bg-red-50 hover:bg-red-50" : ""}`}>
                      {tab === 0 ? <>
                        <td className="px-4 py-2.5 text-slate-600">{s.location.name}</td>
                        <td className="px-4 py-2.5 font-medium text-slate-800">{s.product.name}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{s.product.sku}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">{s.product.category.name}</td>
                        <td className={`px-4 py-2.5 text-right font-semibold ${isLow ? "text-red-600" : "text-slate-800"}`}>{s.quantity}{isLow ? " ⚠" : ""}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">{s.product.unit.name}</td>
                        <td className="px-4 py-2.5 text-right text-slate-500">{s.product.reorderPoint}</td>
                      </> : <>
                        <td className="px-4 py-2.5 font-medium text-slate-800">{s.product.name}</td>
                        <td className="px-4 py-2.5 text-slate-600">{s.location.name}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-red-600">{s.quantity}</td>
                        <td className="px-4 py-2.5 text-right text-slate-500">{s.product.reorderPoint}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-red-700">{s.product.reorderPoint - s.quantity}</td>
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
                  <th className="px-4 py-2.5 text-left font-medium">Date</th>
                  <th className="px-4 py-2.5 text-left font-medium">Order</th>
                  <th className="px-4 py-2.5 text-left font-medium">Type</th>
                  <th className="px-4 py-2.5 text-left font-medium">Product</th>
                  <th className="px-4 py-2.5 text-left font-medium">From</th>
                  <th className="px-4 py-2.5 text-left font-medium">To</th>
                  <th className="px-4 py-2.5 text-right font-medium">Qty</th>
                </tr>
              </thead>
              <tbody>
                {movData.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400 text-xs">No movements in range</td></tr>
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
      )}
    </div>
  );
}
