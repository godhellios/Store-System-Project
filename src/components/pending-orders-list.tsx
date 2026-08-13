"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { opnameOverrideMessage } from "@/components/opname-override-message";
import { useRouter } from "next/navigation";

type OrderLine = {
  id: string;
  quantity: number;
  inputQty: number | null;
  inputUnit: string | null;
  product: { name: string; sku: string; unit: { name: string } };
};

type PendingOrder = {
  id: string;
  orderNumber: string;
  type: string;
  fromLocation: { name: string } | null;
  toLocation: { name: string } | null;
  createdByName: string | null;
  createdAt: string;
  reference: string | null;
  notes: string | null;
  grnStatus: string | null;
  goodsOutStatus: string | null;
  transferStatus: string | null;
  adjustmentStatus: string | null;
  lines: OrderLine[];
};

const TYPE_LABEL: Record<string, string> = {
  GRN: "GRN", GOODS_OUT: "Goods Out", TRANSFER: "Transfer", ADJUSTMENT: "Adjustment",
};
const TYPE_BADGE: Record<string, string> = {
  GRN: "bg-green-100 text-green-700",
  GOODS_OUT: "bg-orange-100 text-orange-700",
  TRANSFER: "bg-blue-100 text-blue-700",
  ADJUSTMENT: "bg-gray-100 text-gray-600",
};

function locationSummary(order: PendingOrder) {
  if (order.type === "TRANSFER")
    return `${order.fromLocation?.name ?? "?"} → ${order.toLocation?.name ?? "?"}`;
  if (order.type === "GRN" || order.type === "ADJUSTMENT")
    return `→ ${order.toLocation?.name ?? "—"}`;
  return `${order.fromLocation?.name ?? "—"}`;
}

function stockEffect(order: PendingOrder) {
  if (order.type === "GRN") return `Approving will credit stock to ${order.toLocation?.name}`;
  if (order.type === "GOODS_OUT") return `Approving will deduct stock from ${order.fromLocation?.name}`;
  if (order.type === "TRANSFER")
    return `Approving will move stock: ${order.fromLocation?.name} → ${order.toLocation?.name}`;
  if (order.type === "ADJUSTMENT") return `Approving will adjust stock at ${order.toLocation?.name}`;
  return "";
}

export function PendingOrdersList() {
  const router = useRouter();
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/orders/pending");
      if (res.ok) {
        setOrders(await res.json());
      } else {
        const data = await res.json().catch(() => ({}));
        setFetchError(`Error ${res.status}: ${data.error ?? res.statusText}`);
      }
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Network error");
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function doAction(id: string, action: "approve" | "reject", note?: string) {
    setProcessingId(id);
    try {
      const send = async (confirm: boolean) => {
        const res = await fetch(`/api/orders/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, note: note?.trim() || undefined, ...(confirm ? { confirm: true } : {}) }),
        });
        return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
      };
      // Approving behind a completed stock count returns a warning, not a result.
      let { ok, status, data } = await send(false);
      if (ok && data.warning === "opname") {
        if (!window.confirm(opnameOverrideMessage(String(data.opnameDateLabel ?? "")))) return;
        ({ ok, status, data } = await send(true));
      }
      if (!ok) { toast.error(data.error ?? `Error ${status}`); return; }
      toast.success(action === "approve" ? "Approved — stock updated" : "Rejected");
      await load();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Request failed");
    } finally {
      setProcessingId(null);
      setRejectingId(null);
      setRejectNote("");
    }
  }

  if (loading) return <div className="text-center py-12 text-slate-400 text-sm">Loading…</div>;

  if (fetchError) return (
    <div className="bg-red-50 border border-red-300 rounded-xl px-5 py-4 text-sm text-red-700">
      <div className="font-semibold mb-1">Failed to load pending orders</div>
      <div className="font-mono text-xs">{fetchError}</div>
      <button onClick={load} className="mt-3 text-xs text-red-600 underline">Retry</button>
    </div>
  );

  if (orders.length === 0) return (
    <div className="bg-white rounded-xl border border-slate-200 px-6 py-12 text-center">
      <div className="text-2xl mb-2">✅</div>
      <div className="text-sm font-semibold text-slate-700">No pending orders</div>
      <div className="text-xs text-slate-400 mt-1">All orders have been reviewed</div>
    </div>
  );

  return (
    <div className="space-y-3">
      {orders.map((o) => {
        const totalQty = o.lines.reduce((s, l) => s + l.quantity, 0);
        const isRejecting = rejectingId === o.id;
        const isProcessing = processingId === o.id;
        const needsExpand = o.lines.length > 3;
        const isExpanded = expandedIds.has(o.id);
        const visibleLines = needsExpand && !isExpanded ? o.lines.slice(0, 3) : o.lines;

        return (
          <div key={o.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-100">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <Link href={`/orders/${o.id}`} className="font-mono font-semibold text-blue-600 text-xs hover:underline flex-shrink-0">
                  {o.orderNumber}
                </Link>
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${TYPE_BADGE[o.type]}`}>
                  {TYPE_LABEL[o.type]}
                </span>
                <span className="text-xs text-slate-500 truncate">{locationSummary(o)}</span>
                {o.reference && <span className="text-[11px] text-slate-400 truncate">Ref: {o.reference}</span>}
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-[11px] text-slate-500">
                  {new Date(o.createdAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" })}
                </div>
                {o.createdByName && <div className="text-[11px] text-slate-400">{o.createdByName}</div>}
              </div>
            </div>

            <div className="px-4 pt-2.5 pb-1">
              <table className="w-full text-xs">
                <tbody>
                  {visibleLines.map((line) => (
                    <tr key={line.id} className="border-b border-slate-50 last:border-0">
                      <td className="py-1.5 pr-3">
                        <div className="font-medium text-slate-700">{line.product.name}</div>
                        <div className="text-slate-400 font-mono text-[11px]">{line.product.sku}</div>
                      </td>
                      <td className="py-1.5 text-right font-semibold text-slate-800 whitespace-nowrap">
                        {line.inputQty != null ? (
                          <>{line.inputQty} <span className="font-normal text-slate-400">{line.inputUnit}</span></>
                        ) : (
                          <>{line.quantity} <span className="font-normal text-slate-400">{line.product.unit.name}</span></>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {needsExpand && !isExpanded && (
                <button onClick={() => toggleExpand(o.id)} className="text-[11px] text-blue-500 hover:underline pb-2">
                  +{o.lines.length - 3} more items…
                </button>
              )}
              {needsExpand && isExpanded && (
                <button onClick={() => toggleExpand(o.id)} className="text-[11px] text-slate-400 hover:underline pb-2">
                  Show less ▲
                </button>
              )}
            </div>

            <div className="px-4 py-3 bg-slate-50 border-t border-slate-100">
              <div className="text-[11px] text-slate-400 mb-2.5">
                {o.lines.length} line{o.lines.length !== 1 ? "s" : ""} · {totalQty} units total · <span className="italic">{stockEffect(o)}</span>
              </div>
              {o.notes && <div className="text-[11px] text-slate-500 mb-2">Note: <span className="italic">{o.notes}</span></div>}

              {isRejecting ? (
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                    placeholder="Reason for rejection (optional)…"
                    className="px-2 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-400 w-full"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") doAction(o.id, "reject", rejectNote);
                      if (e.key === "Escape") { setRejectingId(null); setRejectNote(""); }
                    }}
                  />
                  <div className="flex gap-2">
                    <button onClick={() => doAction(o.id, "reject", rejectNote)} disabled={isProcessing}
                      className="text-xs bg-red-600 hover:bg-red-700 text-white font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
                      {isProcessing ? "…" : "✗ Confirm Reject"}
                    </button>
                    <button onClick={() => { setRejectingId(null); setRejectNote(""); }}
                      className="text-xs px-3 py-1.5 border border-slate-300 rounded-lg text-slate-600 hover:bg-white transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => doAction(o.id, "approve")} disabled={isProcessing}
                    className="text-xs bg-green-600 hover:bg-green-700 text-white font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
                    {isProcessing ? "…" : "✓ Approve"}
                  </button>
                  <button onClick={() => { setRejectingId(o.id); setRejectNote(""); }} disabled={isProcessing}
                    className="text-xs border border-red-300 text-red-600 hover:bg-red-50 font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
                    ✗ Reject
                  </button>
                  <Link href={`/orders/${o.id}`} className="text-xs px-3 py-1.5 border border-slate-300 rounded-lg text-slate-500 hover:bg-white transition-colors">
                    View detail →
                  </Link>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
