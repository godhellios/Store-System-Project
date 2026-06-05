"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props =
  | { mode: "set"; productId: string; currentAvgCost?: never }
  | { mode: "correct"; productId: string; currentAvgCost: number | null };

export function OpeningCostForm({ mode, productId, currentAvgCost }: Props) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  async function submit(cost: number, field: "openingCost" | "correctCost") {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: cost }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to save");
        return;
      }
      setModalOpen(false);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  function handleSetSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cost = parseFloat(value.replace(/[^0-9.]/g, ""));
    if (!cost || cost <= 0) { setError("Enter a valid cost greater than zero"); return; }
    submit(cost, "openingCost");
  }

  function handleCorrectSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cost = parseFloat(value.replace(/[^0-9.]/g, ""));
    if (!cost || cost <= 0) { setError("Enter a valid cost greater than zero"); return; }
    submit(cost, "correctCost");
  }

  if (mode === "set") {
    return (
      <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        <div className="text-xs font-semibold text-amber-700 mb-2">⚠ No cost data yet for this product</div>
        <form onSubmit={handleSetSubmit} className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500">Set Opening Cost:</span>
          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-500">Rp</span>
            <input
              type="number"
              min="1"
              step="any"
              placeholder="e.g. 10000"
              value={value}
              onFocus={(e) => e.target.select()}
              onChange={(e) => { setValue(e.target.value); setError(null); }}
              className="w-32 px-2 py-1 border border-slate-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            />
          </div>
          <button
            type="submit"
            disabled={loading || !value}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded transition-colors"
          >
            {loading ? "Saving…" : "Save"}
          </button>
          {error && <span className="text-xs text-red-600">{error}</span>}
        </form>
      </div>
    );
  }

  // mode === "correct"
  return (
    <>
      <button
        onClick={() => { setModalOpen(true); setValue(""); setError(null); }}
        className="text-[10px] text-slate-400 hover:text-slate-600 underline mt-1 block"
      >
        Correct Cost
      </button>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-sm font-bold text-slate-800 mb-1">Override Average Cost</h3>
            <p className="text-xs text-slate-500 mb-3">
              Current: <span className="font-semibold text-slate-700">
                {currentAvgCost != null ? `Rp ${currentAvgCost.toLocaleString("id-ID")}` : "—"}
              </span>
            </p>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
              This will override the AVCO for all future cost calculations. This action is logged.
            </p>
            <form onSubmit={handleCorrectSubmit} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">New Cost</label>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-500">Rp</span>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    placeholder="e.g. 12000"
                    value={value}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => { setValue(e.target.value); setError(null); }}
                    className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                    disabled={loading}
                  />
                </div>
                {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  disabled={loading}
                  className="px-4 py-1.5 text-xs text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || !value}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-lg transition-colors"
                >
                  {loading ? "Saving…" : "Confirm Override"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
