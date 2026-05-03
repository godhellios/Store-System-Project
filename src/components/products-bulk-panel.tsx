"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import ProductDeactivateButton from "./product-deactivate-button";
import { ProductImageHover } from "./product-image-hover";

type ProductStock = { id: string; locationId: string; quantity: number; location: { id: string; name: string } };
type Product = {
  id: string; name: string; sku: string; barcode: string;
  isActive: boolean; reorderPoint: number;
  colorVariant: string | null; imageUrl: string | null;
  category: { id: string; name: string };
  unit: { id: string; name: string };
  stock: ProductStock[];
};

function hashColor(name: string) {
  const palette = [
    "bg-blue-100 text-blue-700", "bg-purple-100 text-purple-700",
    "bg-green-100 text-green-700", "bg-orange-100 text-orange-700",
    "bg-pink-100 text-pink-700", "bg-cyan-100 text-cyan-700",
    "bg-yellow-100 text-yellow-700", "bg-rose-100 text-rose-700",
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return palette[Math.abs(h) % palette.length];
}

export function ProductsBulkPanel({
  products,
  userRole,
  locationId,
}: {
  products: Product[];
  userRole: string;
  locationId: string;
}) {
  const router = useRouter();
  const isAdmin = userRole === "ADMIN";
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"deactivate" | "delete" | null>(null);

  const allIds = products.map((p) => p.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0;

  function toggleOne(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allIds));
  }

  async function doBulkAction(action: "deactivate" | "delete") {
    setLoading(true);
    setConfirmAction(null);
    const res = await fetch("/api/products/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ids: [...selected] }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { toast.error(data.error ?? "Failed"); return; }
    const ok = (data.results as { status: string }[]).filter((r) => r.status === "ok").length;
    const skipped = (data.results as { status: string; message?: string }[]).filter((r) => r.status !== "ok");
    skipped.forEach((r) => toast(r.message ?? "Skipped", { icon: "⚠️", duration: 5000 }));
    if (ok > 0) toast.success(`${action === "deactivate" ? "Deactivated" : "Deleted"} ${ok} product${ok !== 1 ? "s" : ""}`);
    setSelected(new Set());
    router.refresh();
  }

  const selectedProducts = products.filter((p) => selected.has(p.id));
  const activeSelected = selectedProducts.filter((p) => p.isActive).length;
  const inactiveSelected = selectedProducts.filter((p) => !p.isActive).length;

  return (
    <div>
      {/* ── Desktop table ── */}
      <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                {isAdmin && (
                  <th className="px-3 py-2.5 w-8">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll}
                      className="w-4 h-4 accent-blue-600 cursor-pointer" />
                  </th>
                )}
                <th className="px-4 py-2.5 text-left font-medium">Barcode</th>
                <th className="px-4 py-2.5 text-left font-medium">Code</th>
                <th className="px-4 py-2.5 text-left font-medium">Product Name</th>
                <th className="px-4 py-2.5 text-left font-medium">Category</th>
                <th className="px-4 py-2.5 text-left font-medium">Unit</th>
                <th className="px-4 py-2.5 text-left font-medium">Reorder Pt</th>
                <th className="px-4 py-2.5 text-right font-medium">Total Stock</th>
                <th className="px-4 py-2.5 text-left font-medium">Status</th>
                <th className="px-4 py-2.5 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 ? (
                <tr><td colSpan={isAdmin ? 10 : 9} className="px-4 py-10 text-center text-slate-400 text-xs">
                  No products found. <Link href="/products/add" className="text-blue-600 hover:underline">Add one?</Link>
                </td></tr>
              ) : products.map((p) => {
                const visibleStock = locationId ? p.stock.filter((s) => s.locationId === locationId) : p.stock;
                const totalQty = visibleStock.reduce((s, st) => s + st.quantity, 0);
                const isLow = p.isActive && p.reorderPoint > 0 && visibleStock.some((s) => s.quantity <= p.reorderPoint);
                const isSelected = selected.has(p.id);
                const rowBg = isSelected ? "bg-blue-50" : !p.isActive ? "bg-slate-50 opacity-60" : isLow ? "bg-red-50 hover:bg-red-50" : "hover:bg-slate-50";
                return (
                  <tr key={p.id} className={`border-t border-slate-100 ${rowBg}`}>
                    {isAdmin && (
                      <td className="px-3 py-2.5">
                        <input type="checkbox" checked={isSelected} onChange={() => toggleOne(p.id)}
                          className="w-4 h-4 accent-blue-600 cursor-pointer" />
                      </td>
                    )}
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{p.barcode}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`font-mono text-xs font-medium ${!p.isActive ? "text-slate-400" : "text-blue-600"}`}>{p.sku}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        {p.imageUrl ? <ProductImageHover src={p.imageUrl} /> : <div className="w-8 h-8 rounded border border-dashed border-slate-200 bg-slate-50 flex-shrink-0" />}
                        <div className="min-w-0">
                          <div className={`font-medium flex items-center gap-2 ${!p.isActive ? "text-slate-400 line-through" : "text-slate-800"}`}>
                            <Link href={`/products/${p.id}`} className="hover:text-blue-600 hover:underline">{p.name}</Link>
                            {!p.isActive && (
                              <span className="no-underline text-[10px] font-semibold bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded-full uppercase tracking-wide" style={{ textDecoration: "none" }}>Inactive</span>
                            )}
                          </div>
                          {p.colorVariant && <div className={`text-xs ${!p.isActive ? "text-slate-300" : "text-slate-400"}`}>{p.colorVariant}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${!p.isActive ? "bg-slate-100 text-slate-400" : hashColor(p.category.name)}`}>{p.category.name}</span>
                    </td>
                    <td className={`px-4 py-2.5 text-xs ${!p.isActive ? "text-slate-400" : "text-slate-600"}`}>{p.unit.name}</td>
                    <td className={`px-4 py-2.5 text-xs ${!p.isActive ? "text-slate-400" : "text-slate-600"}`}>
                      {p.reorderPoint > 0 ? `${p.reorderPoint} ${p.unit.name.toLowerCase()}` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className={`font-semibold text-sm ${!p.isActive ? "text-slate-400" : isLow ? "text-red-600" : "text-slate-800"}`}>
                        {totalQty} {p.unit.name.toLowerCase()}
                      </div>
                      {visibleStock.filter((s) => s.quantity > 0).map((s) => {
                        const locLow = p.isActive && p.reorderPoint > 0 && s.quantity <= p.reorderPoint;
                        return (
                          <div key={s.id} className={`text-xs mt-0.5 ${locLow ? "text-red-400" : "text-slate-400"}`}>
                            {!locationId && <span>{s.location.name}: </span>}
                            <span className="font-medium">{s.quantity}</span>
                          </div>
                        );
                      })}
                      {p.stock.every((s) => s.quantity === 0) && totalQty === 0 && (
                        <div className="text-xs text-slate-300 mt-0.5">no stock</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {!p.isActive ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-400 uppercase tracking-wide">Inactive</span>
                      ) : isLow ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-600 uppercase tracking-wide">Low</span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700 uppercase tracking-wide">OK</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-3 items-center">
                        <Link href={`/barcodes?productId=${p.id}`} className="text-xs text-violet-600 hover:underline">▣ Label</Link>
                        <Link href={`/products/${p.id}/edit`} className="text-xs text-blue-600 hover:underline">Edit</Link>
                        <ProductDeactivateButton productId={p.id} isActive={p.isActive} userRole={userRole} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Mobile cards ── */}
      <div className="md:hidden space-y-2">
        {products.length === 0 ? (
          <p className="text-center text-slate-400 text-xs py-10">
            No products found. <Link href="/products/add" className="text-blue-600 hover:underline">Add one?</Link>
          </p>
        ) : products.map((p) => {
          const visibleStock = locationId ? p.stock.filter((s) => s.locationId === locationId) : p.stock;
          const totalQty = visibleStock.reduce((s, st) => s + st.quantity, 0);
          const isLow = p.isActive && p.reorderPoint > 0 && visibleStock.some((s) => s.quantity <= p.reorderPoint);
          const isSelected = selected.has(p.id);
          return (
            <div key={p.id} className={`bg-white rounded-xl border px-4 py-3 ${isSelected ? "border-blue-400 bg-blue-50" : !p.isActive ? "opacity-60 border-slate-200" : isLow ? "border-red-200 bg-red-50" : "border-slate-200"}`}>
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  {isAdmin && (
                    <input type="checkbox" checked={isSelected} onChange={() => toggleOne(p.id)}
                      className="w-4 h-4 accent-blue-600 cursor-pointer flex-shrink-0" />
                  )}
                  {p.imageUrl && <ProductImageHover src={p.imageUrl} />}
                  <Link href={`/products/${p.id}`} className={`font-semibold text-sm leading-tight hover:underline ${!p.isActive ? "text-slate-400 line-through" : "text-slate-800"}`}>
                    {p.name}
                  </Link>
                </div>
                {!p.isActive ? (
                  <span className="flex-shrink-0 text-[10px] font-semibold bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded-full uppercase tracking-wide">Inactive</span>
                ) : isLow ? (
                  <span className="flex-shrink-0 text-[10px] font-semibold bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full uppercase tracking-wide">Low</span>
                ) : (
                  <span className="flex-shrink-0 text-[10px] font-semibold bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full uppercase tracking-wide">OK</span>
                )}
              </div>
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className="font-mono text-xs text-blue-600">{p.sku}</span>
                {p.barcode && p.barcode !== p.sku && (
                  <span className="font-mono text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{p.barcode}</span>
                )}
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${!p.isActive ? "bg-slate-100 text-slate-400" : hashColor(p.category.name)}`}>{p.category.name}</span>
              </div>
              <div className="flex items-baseline gap-1.5 mb-2">
                <span className={`font-semibold text-sm ${!p.isActive ? "text-slate-400" : isLow ? "text-red-600" : "text-slate-800"}`}>{totalQty}</span>
                <span className="text-xs text-slate-500">{p.unit.name.toLowerCase()}</span>
                {visibleStock.filter((s) => s.quantity > 0).map((s) => {
                  const locLow = p.isActive && p.reorderPoint > 0 && s.quantity <= p.reorderPoint;
                  return (
                    <span key={s.id} className={`text-xs ${locLow ? "text-red-400" : "text-slate-400"}`}>
                      · {!locationId && `${s.location.name}: `}<span className="font-medium">{s.quantity}</span>
                    </span>
                  );
                })}
              </div>
              <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
                <Link href={`/barcodes?productId=${p.id}`} className="text-xs text-violet-600 font-medium hover:underline">▣ Label</Link>
                <Link href={`/products/${p.id}/edit`} className="text-xs text-blue-600 font-medium hover:underline">Edit</Link>
                <ProductDeactivateButton productId={p.id} isActive={p.isActive} userRole={userRole} />
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Floating bulk action bar (Admin only) ── */}
      {isAdmin && someSelected && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white rounded-2xl shadow-2xl px-5 py-3 flex items-center gap-3 flex-wrap justify-center">
          <span className="text-sm font-semibold whitespace-nowrap">{selected.size} selected</span>
          <div className="w-px h-5 bg-slate-600 hidden sm:block" />

          {confirmAction === "deactivate" ? (
            <>
              <span className="text-sm text-amber-300 whitespace-nowrap">
                Deactivate {activeSelected} product{activeSelected !== 1 ? "s" : ""}?
              </span>
              <button onClick={() => setConfirmAction(null)} className="text-xs text-slate-400 hover:text-white underline">Cancel</button>
              <button onClick={() => doBulkAction("deactivate")} disabled={loading}
                className="text-xs bg-amber-500 hover:bg-amber-600 font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50 whitespace-nowrap">
                {loading ? "…" : "Yes, Deactivate"}
              </button>
            </>
          ) : confirmAction === "delete" ? (
            <>
              <span className="text-sm text-red-300 whitespace-nowrap">
                Delete {inactiveSelected} product{inactiveSelected !== 1 ? "s" : ""}? Cannot be undone.
              </span>
              <button onClick={() => setConfirmAction(null)} className="text-xs text-slate-400 hover:text-white underline">Cancel</button>
              <button onClick={() => doBulkAction("delete")} disabled={loading}
                className="text-xs bg-red-500 hover:bg-red-600 font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50 whitespace-nowrap">
                {loading ? "…" : "Yes, Delete"}
              </button>
            </>
          ) : (
            <>
              {activeSelected > 0 && (
                <button onClick={() => setConfirmAction("deactivate")} disabled={loading}
                  className="text-xs bg-amber-500 hover:bg-amber-600 font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50 whitespace-nowrap">
                  Deactivate ({activeSelected})
                </button>
              )}
              {inactiveSelected > 0 && (
                <button onClick={() => setConfirmAction("delete")} disabled={loading}
                  className="text-xs bg-red-500 hover:bg-red-600 font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50 whitespace-nowrap">
                  Delete inactive ({inactiveSelected})
                </button>
              )}
              <button onClick={() => setSelected(new Set())}
                className="text-xs text-slate-400 hover:text-white underline whitespace-nowrap">
                Clear
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
