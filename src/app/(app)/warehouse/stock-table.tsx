"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";

type StockRow = {
  id: string;
  quantity: number;
  product: {
    id: string;
    name: string;
    sku: string;
    barcode: string;
    colorVariant: string | null;
    reorderPoint: number;
    isActive: boolean;
    category: { id: string; name: string };
    unit: { name: string };
  };
};

type Props = {
  stock: StockRow[];
  categories: { id: string; name: string }[];
};

export function WarehouseStockTable({ stock, categories }: Props) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function deleteStock(stockId: string) {
    setDeletingId(stockId);
    const res = await fetch(`/api/stock/${stockId}`, { method: "DELETE" });
    setDeletingId(null);
    setConfirmingId(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to remove stock record");
      return;
    }
    toast.success("Stock record removed");
    router.refresh();
  }

  const filtered = stock.filter((s) => {
    const matchQ =
      !q ||
      s.product.name.toLowerCase().includes(q.toLowerCase()) ||
      s.product.sku.toLowerCase().includes(q.toLowerCase()) ||
      s.product.barcode.toLowerCase().includes(q.toLowerCase());
    const matchCat = !categoryId || s.product.category.id === categoryId;
    return matchQ && matchCat;
  });

  const totalQty = filtered.reduce((sum, s) => sum + s.quantity, 0);
  const lowCount = filtered.filter(
    (s) => s.product.isActive && s.product.reorderPoint > 0 && s.quantity <= s.product.reorderPoint
  ).length;

  return (
    <div>
      {/* Filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, SKU, or barcode…"
          className="flex-1 min-w-[200px] px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <div className="flex items-center gap-3 text-xs text-slate-500 px-1">
          <span>{filtered.length} product{filtered.length !== 1 ? "s" : ""}</span>
          <span>·</span>
          <span>{totalQty} units total</span>
          {lowCount > 0 && (
            <>
              <span>·</span>
              <span className="text-red-500 font-medium">{lowCount} low stock</span>
            </>
          )}
        </div>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden space-y-2">
        {filtered.length === 0 ? (
          <p className="text-center text-xs text-slate-400 py-10">No items found</p>
        ) : filtered.map((s) => {
          const isLow = s.product.isActive && s.product.reorderPoint > 0 && s.quantity <= s.product.reorderPoint;
          return (
            <div
              key={s.id}
              className={`bg-white dark:bg-slate-800 rounded-xl border px-4 py-3 ${
                !s.product.isActive
                  ? "opacity-60 border-slate-200 dark:border-slate-700"
                  : isLow
                  ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40"
                  : "border-slate-200 dark:border-slate-700"
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="min-w-0">
                  <div className={`font-medium text-sm ${!s.product.isActive ? "text-slate-400 line-through" : "text-slate-800"}`}>
                    {s.product.name}
                    {s.product.colorVariant && <span className="text-slate-400 font-normal"> — {s.product.colorVariant}</span>}
                  </div>
                  <div className="text-xs font-mono text-slate-400 mt-0.5">{s.product.sku} · {s.product.category.name}</div>
                </div>
                {!s.product.isActive ? (
                  <span className="flex-shrink-0 text-[10px] font-semibold bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded-full uppercase tracking-wide">Inactive</span>
                ) : isLow ? (
                  <span className="flex-shrink-0 text-[10px] font-semibold bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded-full uppercase tracking-wide">Low</span>
                ) : (
                  <span className="flex-shrink-0 text-[10px] font-semibold bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full uppercase tracking-wide">OK</span>
                )}
              </div>
              <div className="flex items-baseline gap-2 mt-1">
                <span className={`font-semibold text-sm ${!s.product.isActive ? "text-slate-400" : isLow ? "text-red-600 dark:text-red-400" : "text-slate-800 dark:text-slate-100"}`}>
                  {s.quantity}
                </span>
                <span className="text-xs text-slate-500">{s.product.unit.name.toLowerCase()}</span>
                {s.product.reorderPoint > 0 && (
                  <span className="text-xs text-slate-400">· reorder at {s.product.reorderPoint}</span>
                )}
              </div>
              {/* Action buttons */}
              <div className="flex items-center gap-2 mt-3 pt-2 border-t border-slate-100 dark:border-slate-700">
                <Link
                  href={`/products/${s.product.id}`}
                  className="flex-1 text-center text-xs px-3 py-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50"
                >
                  View Detail
                </Link>
                {confirmingId === s.id ? (
                  <div className="flex items-center gap-1.5 flex-1 justify-end">
                    <span className="text-xs text-slate-600">Remove?</span>
                    <button
                      onClick={() => setConfirmingId(null)}
                      className="text-xs px-2.5 py-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50"
                    >No</button>
                    <button
                      onClick={() => deleteStock(s.id)}
                      disabled={deletingId === s.id}
                      className="text-xs px-2.5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50"
                    >
                      {deletingId === s.id ? "…" : "Yes"}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmingId(s.id)}
                    className="flex-1 text-xs px-3 py-2 border border-red-300 rounded-lg text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="px-4 py-2.5 text-left font-medium">Product</th>
                <th className="px-4 py-2.5 text-left font-medium">SKU</th>
                <th className="px-4 py-2.5 text-left font-medium">Category</th>
                <th className="px-4 py-2.5 text-right font-medium">Qty</th>
                <th className="px-4 py-2.5 text-right font-medium">Reorder Pt</th>
                <th className="px-4 py-2.5 text-left font-medium">Status</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-xs text-slate-400">
                    No items found
                  </td>
                </tr>
              ) : filtered.map((s) => {
                const isLow = s.product.isActive && s.product.reorderPoint > 0 && s.quantity <= s.product.reorderPoint;
                const rowBg = !s.product.isActive
                  ? "opacity-50"
                  : isLow
                  ? "bg-red-50 dark:bg-red-950/40"
                  : "hover:bg-slate-50";
                return (
                  <tr key={s.id} className={`border-t border-slate-100 ${rowBg}`}>
                    <td className="px-4 py-3">
                      <div className={`font-medium ${!s.product.isActive ? "text-slate-400 line-through" : "text-slate-800"}`}>
                        {s.product.name}
                        {s.product.colorVariant && (
                          <span className="text-slate-400 font-normal"> — {s.product.colorVariant}</span>
                        )}
                      </div>
                      <div className="text-xs font-mono text-slate-400">{s.product.barcode}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-blue-600">{s.product.sku}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{s.product.category.name}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-semibold ${!s.product.isActive ? "text-slate-400" : isLow ? "text-red-600 dark:text-red-400" : "text-slate-800"}`}>
                        {s.quantity}
                      </span>
                      <span className="text-xs text-slate-400 ml-1">{s.product.unit.name.toLowerCase()}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-slate-400">
                      {s.product.reorderPoint > 0 ? `${s.product.reorderPoint} ${s.product.unit.name.toLowerCase()}` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {!s.product.isActive ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-400 uppercase tracking-wide">Inactive</span>
                      ) : isLow ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-600 uppercase tracking-wide">Low</span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700 uppercase tracking-wide">OK</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {confirmingId === s.id ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-slate-600 font-medium">Remove?</span>
                          <button
                            onClick={() => setConfirmingId(null)}
                            className="text-xs px-2.5 py-1.5 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50"
                          >No</button>
                          <button
                            onClick={() => deleteStock(s.id)}
                            disabled={deletingId === s.id}
                            className="text-xs px-2.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50"
                          >
                            {deletingId === s.id ? "…" : "Yes, remove"}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/products/${s.product.id}`}
                            className="text-xs px-3 py-1.5 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50"
                          >
                            View
                          </Link>
                          <button
                            onClick={() => setConfirmingId(s.id)}
                            className="text-xs px-3 py-1.5 border border-red-300 rounded-lg text-red-600 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
