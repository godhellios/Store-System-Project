"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

type Line = {
  id: string;
  quantity: number;
  notes: string | null;
  product: { name: string; sku: string };
};

type Order = {
  id: string;
  reference: string | null;
  notes: string | null;
  lines: Line[];
};

export function OrderEditForm({ order }: { order: Order }) {
  const router = useRouter();
  const [reference, setReference] = useState(order.reference ?? "");
  const [notes, setNotes] = useState(order.notes ?? "");
  const [lineNotes, setLineNotes] = useState<Record<string, string>>(
    Object.fromEntries(order.lines.map((l) => [l.id, l.notes ?? ""]))
  );
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(`/api/orders/${order.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reference: reference || null,
        notes: notes || null,
        lineNotes: order.lines.map((l) => ({ id: l.id, notes: lineNotes[l.id] || null })),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error ?? "Failed to update order");
      return;
    }
    toast.success("Order updated");
    router.push(`/orders/${order.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Reference</label>
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="e.g. Invoice #001"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Order Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          placeholder="Optional notes…"
        />
      </div>

      {order.lines.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-2">Line Notes</label>
          <div className="space-y-3">
            {order.lines.map((line) => (
              <div key={line.id}>
                <div className="text-xs font-medium text-slate-700 mb-1">
                  {line.product.name}
                  <span className="font-normal text-slate-400 ml-2 font-mono">{line.product.sku}</span>
                  <span className="font-normal text-slate-400 ml-2">· qty {line.quantity}</span>
                </div>
                <input
                  value={lineNotes[line.id] ?? ""}
                  onChange={(e) => setLineNotes((n) => ({ ...n, [line.id]: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Line notes…"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors"
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="px-5 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
