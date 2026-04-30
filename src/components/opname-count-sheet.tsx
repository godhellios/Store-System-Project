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
  const [confirmingApprove, setConfirmingApprove] = useState(false);

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
    const res = await fetch(`/api/opname/${session.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    if (!res.ok) { toast.error("Failed to approve"); return; }
    toast.success("Opname approved and stock adjusted");
    setConfirmingApprove(false);
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

        {/* Mobile card list */}
        <div className="md:hidden divide-y divide-slate-100">
          {session.lines.map((line) => {
            const phys = counts[line.id] !== "" ? parseInt(counts[line.id]) : null;
            const diff = phys !== null ? phys - line.bookQty : null;
            const hasDisc = diff !== null && diff !== 0;
            return (
              <div key={line.id} className={`px-4 py-3 ${hasDisc ? "bg-red-50 dark:bg-red-950/40" : ""}`}>
                {/* Product name + SKU */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800 text-sm leading-tight">{line.product.name}</div>
                    <div className="text-xs font-mono text-slate-400 mt-0.5">{line.product.sku} · {line.product.category.name}</div>
                  </div>
                  {diff !== null && (
                    <span className={`flex-shrink-0 text-sm font-bold ${diff === 0 ? "text-green-600" : diff > 0 ? "text-blue-600" : "text-red-600"}`}>
                      {diff === 0 ? "✓" : diff > 0 ? `+${diff}` : diff}
                    </span>
                  )}
                </div>
                {/* Book qty + input row */}
                <div className="flex items-center gap-3">
                  <div className="text-xs text-slate-500">
                    System: <span className="font-semibold text-slate-700">{line.bookQty}</span> {line.product.unit.name}
                  </div>
                  <div className="flex-1" />
                  {isEditable ? (
                    <input
                      type="number" inputMode="numeric" min="0" value={counts[line.id]}
                      onChange={(e) => setCount(line.id, e.target.value)}
                      className="w-28 text-center px-3 py-3 border-2 border-slate-300 rounded-xl text-base font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Count"
                    />
                  ) : (
                    <span className="text-base font-semibold text-slate-800">
                      {line.physicalQty ?? "—"} <span className="text-xs font-normal text-slate-500">{line.product.unit.name}</span>
                    </span>
                  )}
                </div>
                {line.notes && <div className="text-xs text-slate-400 mt-1.5">{line.notes}</div>}
              </div>
            );
          })}
        </div>

        {/* Desktop table */}
        <table className="hidden md:table w-full text-sm border-collapse">
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
                <tr key={line.id} className={`border-t border-slate-100 ${hasDisc ? "bg-red-50 dark:bg-red-950/40" : ""}`}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-slate-800">{line.product.name}</div>
                    <div className="text-xs font-mono text-slate-400">{line.product.sku}</div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{line.product.category.name}</td>
                  <td className="px-4 py-2.5 text-right text-slate-600">{line.bookQty}</td>
                  <td className="px-4 py-2.5 text-center">
                    {isEditable ? (
                      <input
                        type="number" inputMode="numeric" min="0" value={counts[line.id]}
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
        <div className="flex gap-3 items-center flex-wrap">
          <span className="text-xs text-slate-500">{discrepancies} discrepanc{discrepancies !== 1 ? "ies" : "y"} will generate adjustment orders on approval.</span>
          {confirmingApprove ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-600 font-medium">Approve and adjust stock?</span>
              <button onClick={() => setConfirmingApprove(false)} className="text-xs px-3 py-1.5 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={approve} className="text-xs bg-green-600 hover:bg-green-700 text-white font-semibold px-3 py-1.5 rounded-lg">Yes, approve</button>
            </div>
          ) : (
            <button onClick={() => setConfirmingApprove(true)}
              className="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-5 py-2 rounded-lg">
              Approve & Adjust Stock
            </button>
          )}
        </div>
      )}
    </div>
  );
}
