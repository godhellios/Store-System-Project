"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";

type UnitConversion = { id: string; name: string; conversionFactor: number; barcode: string | null };
type PendingProduct = {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  colorVariant: string | null;
  description: string | null;
  approvalStatus: string;
  pendingChanges: unknown;
  pendingChangedBy: string | null;
  pendingChangedAt: string | null;
  category: { name: string };
  unit: { name: string };
  unitConversions: UnitConversion[];
};

function PendingTypeBadge({ product }: { product: PendingProduct }) {
  if (product.approvalStatus === "DRAFT") {
    return <span className="text-[10px] font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">New Product</span>;
  }
  return <span className="text-[10px] font-semibold bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full">Edit Request</span>;
}

export default function PendingApprovalPage() {
  const router = useRouter();
  const [products, setProducts] = useState<PendingProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [bulkAction, setBulkAction] = useState<"approve" | "reject" | null>(null);
  const [bulkNote, setBulkNote] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [printQueue, setPrintQueue] = useState<Array<{ id: string; name: string; barcode: string; colorVariant: string | null }>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/products/pending");
    if (res.ok) setProducts(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function toggleOne(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  const allSelected = products.length > 0 && products.every((p) => selected.has(p.id));
  function toggleAll() { setSelected(allSelected ? new Set() : new Set(products.map((p) => p.id))); }

  async function doAction(id: string, action: "approve" | "reject", note?: string) {
    const product = products.find((p) => p.id === id);
    setProcessingId(id);
    const res = await fetch(`/api/products/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note }),
    });
    const data = await res.json();
    setProcessingId(null);
    setRejectingId(null);
    setRejectNote("");
    if (!res.ok) { toast.error(data.error ?? "Failed"); return; }
    if (action === "approve" && product) {
      setPrintQueue((q) => [...q, { id: product.id, name: product.name, barcode: product.barcode, colorVariant: product.colorVariant }]);
    } else {
      toast.success("Rejected");
    }
    setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
    await load();
    router.refresh();
  }

  async function doBulk(action: "approve" | "reject", note?: string) {
    if (selected.size === 0) return;
    const approvedProducts = action === "approve"
      ? products.filter((p) => selected.has(p.id) && p.approvalStatus === "DRAFT")
      : [];
    const res = await fetch("/api/products/approve-bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selected], action, note }),
    });
    const data = await res.json();
    setBulkAction(null);
    setBulkNote("");
    if (!res.ok) { toast.error(data.error ?? "Failed"); return; }
    toast.success(`${action === "approve" ? "Approved" : "Rejected"} ${data.updated} product${data.updated !== 1 ? "s" : ""}`);
    if (data.editRequestsSkipped > 0) {
      toast(`${data.editRequestsSkipped} edit request${data.editRequestsSkipped !== 1 ? "s" : ""} skipped â€” open each one to approve changes individually`, { icon: "âš ï¸" });
    }
    if (approvedProducts.length > 0) {
      setPrintQueue((q) => [...q, ...approvedProducts.map((p) => ({ id: p.id, name: p.name, barcode: p.barcode, colorVariant: p.colorVariant }))]);
    }
    setSelected(new Set());
    await load();
    router.refresh();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
        <div className="flex items-center gap-3">
          <Link href="/products" className="text-xs text-slate-500 hover:underline">â† Products</Link>
          <h1 className="text-base font-semibold text-slate-800">Pending Approval</h1>
          {!loading && (
            <span className="bg-amber-100 text-amber-700 text-xs font-semibold px-2 py-0.5 rounded-full">{products.length}</span>
          )}
        </div>
        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">{selected.size} selected</span>
            <button onClick={() => setBulkAction("approve")}
              className="text-xs bg-green-600 hover:bg-green-700 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors">
              Approve All
            </button>
            <button onClick={() => setBulkAction("reject")}
              className="text-xs bg-red-500 hover:bg-red-600 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors">
              Reject All
            </button>
          </div>
        )}
      </div>

      {/* Bulk action confirm */}
      {bulkAction && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4">
          <p className="text-sm font-medium text-slate-700 mb-2">
            {bulkAction === "approve" ? `Approve ${selected.size} item${selected.size !== 1 ? "s" : ""}?` : `Reject ${selected.size} item${selected.size !== 1 ? "s" : ""}?`}
          </p>
          <textarea value={bulkNote} onChange={(e) => setBulkNote(e.target.value)}
            placeholder="Optional noteâ€¦" rows={2}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none mb-3" />
          <div className="flex gap-2">
            <button onClick={() => doBulk(bulkAction, bulkNote)}
              className={`text-xs font-semibold px-4 py-2 rounded-lg text-white transition-colors ${bulkAction === "approve" ? "bg-green-600 hover:bg-green-700" : "bg-red-500 hover:bg-red-600"}`}>
              Confirm {bulkAction === "approve" ? "Approve" : "Reject"}
            </button>
            <button onClick={() => { setBulkAction(null); setBulkNote(""); }}
              className="text-xs px-4 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      )}

      {/* Print label prompt â€” shown after approvals */}
      {printQueue.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-green-600 text-base">âœ…</span>
              <span className="text-sm font-semibold text-green-800">
                {printQueue.length === 1 ? "Product approved" : `${printQueue.length} products approved`} â€” print barcode label{printQueue.length !== 1 ? "s" : ""}?
              </span>
            </div>
            <button onClick={() => setPrintQueue([])} className="text-xs text-green-600 hover:text-green-800 underline">Dismiss</button>
          </div>
          <div className="space-y-2">
            {printQueue.map((p) => (
              <div key={p.id} className="flex items-center justify-between bg-white border border-green-100 rounded-lg px-3 py-2">
                <div>
                  <span className="text-sm font-medium text-slate-800">{p.name}{p.colorVariant ? ` â€” ${p.colorVariant}` : ""}</span>
                  <span className="ml-2 text-xs font-mono text-slate-400">{p.barcode}</span>
                </div>
                <Link
                  href={`/barcodes?productId=${p.id}`}
                  className="text-xs bg-violet-600 hover:bg-violet-700 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                >
                  ðŸ–¨ Print Label
                </Link>
              </div>
            ))}
          </div>
          {printQueue.length > 1 && (
            <div className="mt-3 pt-3 border-t border-green-100">
              <Link
                href={`/barcodes?productId=${printQueue[0].id}`}
                className="text-xs text-green-700 hover:underline font-medium"
              >
                Print all labels one by one â†’
              </Link>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-slate-400 text-sm">Loadingâ€¦</div>
      ) : products.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 px-6 py-16 text-center">
          <div className="text-3xl mb-3">âœ…</div>
          <div className="text-sm font-semibold text-slate-700">All caught up</div>
          <div className="text-xs text-slate-400 mt-1">No products awaiting approval</div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="px-3 py-2.5 w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="w-4 h-4 accent-blue-600 cursor-pointer" />
                </th>
                <th className="px-4 py-2.5 text-left font-medium">Product</th>
                <th className="px-4 py-2.5 text-left font-medium">SKU</th>
                <th className="px-4 py-2.5 text-left font-medium">Type</th>
                <th className="px-4 py-2.5 text-left font-medium">Submitted By</th>
                <th className="px-4 py-2.5 text-left font-medium">Date</th>
                <th className="px-4 py-2.5 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <>
                  <tr key={p.id} className={`border-t border-slate-100 ${selected.has(p.id) ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                    <td className="px-3 py-2.5">
                      <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleOne(p.id)}
                        className="w-4 h-4 accent-blue-600 cursor-pointer" />
                    </td>
                    <td className="px-4 py-2.5">
                      <button onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                        className="font-medium text-slate-800 text-xs text-left hover:text-blue-600">
                        {p.name}{p.colorVariant ? ` â€” ${p.colorVariant}` : ""}
                        <span className="ml-1 text-slate-400">{expandedId === p.id ? "â–²" : "â–¼"}</span>
                      </button>
                      {p.unitConversions.length > 0 && (
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          +{p.unitConversions.length} unit conversion{p.unitConversions.length !== 1 ? "s" : ""}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-blue-600">{p.sku}</td>
                    <td className="px-4 py-2.5"><PendingTypeBadge product={p} /></td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">{p.pendingChangedBy ?? "â€”"}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">
                      {p.pendingChangedAt
                        ? new Date(p.pendingChangedAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })
                        : "â€”"}
                    </td>
                    <td className="px-4 py-3">
                      {rejectingId === p.id ? (
                        <div className="flex flex-col gap-1.5 min-w-[200px]">
                          <input type="text" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)}
                            placeholder="Reason (optional)â€¦"
                            className="px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-red-500"
                            autoFocus
                            onKeyDown={(e) => { if (e.key === "Enter") doAction(p.id, "reject", rejectNote); if (e.key === "Escape") { setRejectingId(null); setRejectNote(""); } }}
                          />
                          <div className="flex gap-1">
                            <button onClick={() => doAction(p.id, "reject", rejectNote)} disabled={processingId === p.id}
                              className="text-[11px] bg-red-500 hover:bg-red-600 text-white font-semibold px-2 py-1 rounded disabled:opacity-50">
                              {processingId === p.id ? "â€¦" : "Confirm"}
                            </button>
                            <button onClick={() => { setRejectingId(null); setRejectNote(""); }}
                              className="text-[11px] px-2 py-1 border border-slate-200 rounded text-slate-500 hover:bg-slate-50">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button onClick={() => doAction(p.id, "approve")} disabled={processingId === p.id}
                            className="text-xs bg-green-600 hover:bg-green-700 text-white font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
                            {processingId === p.id ? "â€¦" : "Approve"}
                          </button>
                          <button onClick={() => setRejectingId(p.id)} disabled={processingId === p.id}
                            className="text-xs border border-red-300 text-red-500 hover:bg-red-50 font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
                            Reject
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {/* Expanded detail row */}
                  {expandedId === p.id && (
                    <tr key={`${p.id}-detail`} className="bg-slate-50 border-t border-slate-100">
                      <td />
                      <td colSpan={6} className="px-4 py-3 text-xs">
                        {p.approvalStatus === "DRAFT" ? (
                          <div className="space-y-1">
                            <div><span className="text-slate-500">Category:</span> <span className="font-medium">{p.category.name}</span></div>
                            <div><span className="text-slate-500">Unit:</span> <span className="font-medium">{p.unit.name}</span></div>
                            <div><span className="text-slate-500">Barcode:</span> <span className="font-mono">{p.barcode}</span></div>
                            {p.description && <div><span className="text-slate-500">Notes:</span> {p.description}</div>}
                            {p.unitConversions.map((c) => (
                              <div key={c.id} className="text-slate-600">â†³ 1 {c.name} = {c.conversionFactor} {p.unit.name} {c.barcode && <span className="font-mono text-slate-400">Â· {c.barcode}</span>}</div>
                            ))}
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <div className="font-medium text-slate-600 mb-1">Proposed changes:</div>
                            {Object.entries((p.pendingChanges as Record<string, unknown>) ?? {}).map(([k, v]) => (
                              k !== "unitConversions" && (
                                <div key={k}><span className="text-slate-400">{k}:</span> <span className="font-medium">{String(v ?? "â€”")}</span></div>
                              )
                            ))}
                            {Array.isArray((p.pendingChanges as Record<string, unknown>)?.unitConversions) && (
                              <div className="text-slate-500">Unit conversions updated ({((p.pendingChanges as Record<string, unknown>).unitConversions as unknown[]).length} entries)</div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

