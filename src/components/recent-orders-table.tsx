"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type RecentOrder = {
  id: string;
  orderNumber: string;
  type: string;
  createdAt: Date | string;
  lines: { quantity: number; product: { category: { name: string } } }[];
};

type OrderDetail = {
  id: string;
  orderNumber: string;
  type: string;
  createdAt: string;
  reference: string | null;
  notes: string | null;
  fromLocation: { name: string } | null;
  toLocation: { name: string } | null;
  lines: {
    id: string;
    quantity: number;
    notes: string | null;
    product: { name: string; sku: string; category: { name: string }; unit: { name: string } };
  }[];
};

const TYPE_COLOR: Record<string, string> = {
  GRN: "bg-green-100 text-green-700",
  GOODS_OUT: "bg-orange-100 text-orange-700",
  TRANSFER: "bg-blue-100 text-blue-700",
  ADJUSTMENT: "bg-gray-100 text-gray-600",
};
const TYPE_LABEL: Record<string, string> = {
  GRN: "GRN", GOODS_OUT: "Goods Out", TRANSFER: "Transfer", ADJUSTMENT: "Adjustment",
};

export default function RecentOrdersTable({ orders }: { orders: RecentOrder[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const close = useCallback(() => { setSelectedId(null); setDetail(null); }, []);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    setDetail(null);
    fetch(`/api/orders/${selectedId}`)
      .then((r) => r.json())
      .then((d) => { setDetail(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [selectedId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  return (
    <>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <th className="px-4 py-2.5 text-left font-medium">Document</th>
            <th className="px-4 py-2.5 text-left font-medium">Type</th>
            <th className="px-4 py-2.5 text-left font-medium">Qty · Categories</th>
            <th className="px-4 py-2.5 text-left font-medium">Date</th>
            <th className="px-4 py-2.5"></th>
          </tr>
        </thead>
        <tbody>
          {orders.length === 0 ? (
            <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400 text-xs">No orders yet</td></tr>
          ) : orders.map((order) => {
            const totalQty = order.lines.reduce((s, l) => s + l.quantity, 0);
            const cats = [...new Set(order.lines.map((l) => l.product.category.name))];
            const catLabel = cats.length <= 2 ? cats.join(", ") : `${cats.slice(0, 2).join(", ")} +${cats.length - 2}`;
            return (
            <tr key={order.id} className="border-t border-slate-50 hover:bg-slate-50">
              <td className="px-4 py-2.5 font-mono font-semibold text-blue-600 text-xs">{order.orderNumber}</td>
              <td className="px-4 py-2.5">
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLOR[order.type]}`}>
                  {TYPE_LABEL[order.type]}
                </span>
              </td>
              <td className="px-4 py-2.5">
                <div className="font-semibold text-gray-900 text-xs">{totalQty} pcs</div>
                <div className="text-xs text-slate-400 mt-0.5">{catLabel || "—"}</div>
              </td>
              <td className="px-4 py-2.5 text-slate-500 text-xs">
                {new Date(order.createdAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </td>
              <td className="px-4 py-2.5 text-right">
                <button onClick={() => setSelectedId(order.id)} className="text-xs text-blue-600 hover:underline">
                  View
                </button>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>

      {/* Modal */}
      {selectedId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={close} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              {detail ? (
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-slate-800">{detail.orderNumber}</span>
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLOR[detail.type]}`}>
                    {TYPE_LABEL[detail.type]}
                  </span>
                </div>
              ) : (
                <span className="text-slate-400 text-sm">Loading…</span>
              )}
              <div className="flex items-center gap-3">
                {detail && (
                  <Link href={`/orders/${detail.id}`} className="text-xs text-blue-600 hover:underline">
                    Open full page →
                  </Link>
                )}
                <button onClick={close} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
              </div>
            </div>

            {/* Body */}
            <div className="overflow-y-auto p-5 flex-1">
              {loading && <p className="text-center text-slate-400 text-sm py-8">Loading…</p>}
              {detail && (
                <>
                  <div className="grid grid-cols-2 gap-4 text-sm text-gray-900 mb-5">
                    <div>
                      <span className="text-xs text-slate-500 block mb-0.5">Date</span>
                      {new Date(detail.createdAt).toLocaleString("id-ID", { dateStyle: "full", timeStyle: "short" })}
                    </div>
                    {detail.fromLocation && (
                      <div>
                        <span className="text-xs text-slate-500 block mb-0.5">From</span>
                        {detail.fromLocation.name}
                      </div>
                    )}
                    {detail.toLocation && (
                      <div>
                        <span className="text-xs text-slate-500 block mb-0.5">To</span>
                        {detail.toLocation.name}
                      </div>
                    )}
                    {detail.reference && (
                      <div>
                        <span className="text-xs text-slate-500 block mb-0.5">Reference</span>
                        {detail.reference}
                      </div>
                    )}
                    {detail.notes && (
                      <div className="col-span-2">
                        <span className="text-xs text-slate-500 block mb-0.5">Notes</span>
                        {detail.notes}
                      </div>
                    )}
                  </div>

                  <table className="w-full text-sm border-collapse border border-slate-200 rounded-lg overflow-hidden">
                    <thead>
                      <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                        <th className="px-3 py-2 text-left font-medium">#</th>
                        <th className="px-3 py-2 text-left font-medium">Product</th>
                        <th className="px-3 py-2 text-left font-medium">Category</th>
                        <th className="px-3 py-2 text-right font-medium">Qty</th>
                        <th className="px-3 py-2 text-left font-medium">Unit</th>
                        {detail.lines.some((l) => l.notes) && <th className="px-3 py-2 text-left font-medium">Notes</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lines.map((line, i) => (
                        <tr key={line.id} className="border-t border-slate-100">
                          <td className="px-3 py-2 text-slate-500 text-xs">{i + 1}</td>
                          <td className="px-3 py-2">
                            <div className="font-medium text-gray-900">{line.product.name}</div>
                            <div className="text-xs font-mono text-slate-500">{line.product.sku}</div>
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-700">{line.product.category.name}</td>
                          <td className="px-3 py-2 text-right font-semibold text-gray-900">{line.quantity}</td>
                          <td className="px-3 py-2 text-xs text-gray-700">{line.product.unit.name}</td>
                          {detail.lines.some((l) => l.notes) && (
                            <td className="px-3 py-2 text-xs text-gray-700">{line.notes ?? "—"}</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-xs text-slate-500 text-right mt-2">
                    {detail.lines.length} line{detail.lines.length !== 1 ? "s" : ""} · {detail.lines.reduce((s, l) => s + l.quantity, 0)} items total
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
