"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

type Line = {
  id: string; bookQty: number; physicalQty: number | null; difference: number | null; notes: string | null;
  product: { name: string; sku: string; category: { name: string }; unit: { name: string } };
};
type Session = { id: string; sessionNumber: string; status: string; notes: string | null; lines: Line[] };

export function OpnameCountSheet({ session }: { session: Session }) {
  const router = useRouter();
  const isEditable = session.status === "IN_PROGRESS";
  const isReviewing = session.status === "REVIEWING";

  const [counts, setCounts] = useState<Record<string, string>>(
    Object.fromEntries(session.lines.map((l) => [l.id, l.physicalQty?.toString() ?? ""]))
  );
  const [saving, setSaving] = useState(false);

  function setCount(id: string, v: string) { setCounts((c) => ({ ...c, [id]: v })); }

  async function saveCounts() {
    setSaving(true);
    const lines = session.lines.map((l) => ({
      id: l.id,
      physicalQty: parseInt(counts[l.id]) || 0,
    }));
    const res = await fetch(`/api/opname/${session.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update-counts", lines }),
    });
    setSaving(false);
    if (!res.ok) { toast.error("Failed to save counts"); return; }
    toast.success("Counts saved");
    router.refresh();
  }

  async function submitForReview() {
    await saveCounts();
    const res = await fetch(`/api/opname/${session.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "submit" }),
    });
    if (!res.ok) { toast.error("Failed to submit"); return; }
    toast.success("Submitted for review");
    router.refresh();
  }

  async function approve() {
    if (!confirm("Approve this opname? This will create adjustment orders for all discrepancies and update stock.")) return;
    const res = await fetch(`/api/opname/${session.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    if (!res.ok) { toast.error("Failed to approve"); return; }
    toast.success("Opname approved and stock adjusted");
    router.push("/opname");
    router.refresh();
  }

  const filledCount = session.lines.filter((l) => counts[l.id] !== "").length;
  const discrepancies = session.lines.filter((l) => {
    const phys = parseInt(counts[l.id]);
    return !isNaN(phys) && phys !== l.bookQty;
  }).length;

  return (
    <div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-4">
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>{filledCount}/{session.lines.length} counted · {discrepancies} discrepanc{discrepancies !== 1 ? "ies" : "y"}</span>
          <span className={`font-medium ${session.status === "APPROVED" ? "text-green-600" : session.status === "REVIEWING" ? "text-blue-600" : "text-yellow-600"}`}>
            {session.status.replace("_", " ")}
          </span>
        </div>

        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <th className="px-4 py-2.5 text-left font-medium">Product</th>
              <th className="px-4 py-2.5 text-left font-medium">Category</th>
              <th className="px-4 py-2.5 text-right font-medium">Book Qty</th>
              <th className="px-4 py-2.5 text-center font-medium">Physical Qty</th>
              <th className="px-4 py-2.5 text-right font-medium">Difference</th>
              <th className="px-4 py-2.5 text-left font-medium">Unit</th>
              <th className="px-4 py-2.5 text-left font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {session.lines.map((line) => {
              const phys = counts[line.id] !== "" ? parseInt(counts[line.id]) : null;
              const diff = phys !== null ? phys - line.bookQty : null;
              const hasDisc = diff !== null && diff !== 0;
              return (
                <tr key={line.id} className={`border-t border-slate-100 ${hasDisc ? "bg-red-50" : ""}`}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-slate-800">{line.product.name}</div>
                    <div className="text-xs font-mono text-slate-400">{line.product.sku}</div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{line.product.category.name}</td>
                  <td className="px-4 py-2.5 text-right text-slate-600">{line.bookQty}</td>
                  <td className="px-4 py-2.5 text-center">
                    {isEditable ? (
                      <input
                        type="number" min="0" value={counts[line.id]}
                        onChange={(e) => setCount(line.id, e.target.value)}
                        className="w-24 text-center px-2 py-1 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="—"
                      />
                    ) : (
                      <span className="text-slate-800">{line.physicalQty ?? "—"}</span>
                    )}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-semibold ${diff === null ? "text-slate-300" : diff === 0 ? "text-green-600" : diff > 0 ? "text-blue-600" : "text-red-600"}`}>
                    {diff === null ? "—" : diff === 0 ? "✓" : diff > 0 ? `+${diff}` : diff}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{line.product.unit.name}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-400">{line.notes ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {isEditable && (
        <div className="flex gap-3">
          <button onClick={saveCounts} disabled={saving}
            className="px-5 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            {saving ? "Saving…" : "Save Draft"}
          </button>
          <button onClick={submitForReview} disabled={saving || filledCount === 0}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg">
            Submit for Review
          </button>
        </div>
      )}

      {isReviewing && (
        <div className="flex gap-3 items-center">
          <span className="text-xs text-slate-500">{discrepancies} discrepanc{discrepancies !== 1 ? "ies" : "y"} will generate adjustment orders on approval.</span>
          <button onClick={approve}
            className="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-5 py-2 rounded-lg">
            Approve & Adjust Stock
          </button>
        </div>
      )}
    </div>
  );
}
