"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

type Location = { id: string; name: string };
type Category = { id: string; name: string };

export function NewOpnameButton({ locations, categories }: { locations: Location[]; categories: Category[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [locationId, setLocationId] = useState("");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  function toggleCategory(id: string, checked: boolean) {
    setCategoryIds((prev) => (checked ? [...prev, id] : prev.filter((c) => c !== id)));
  }

  function close() {
    setOpen(false);
    setCategoryIds([]);
  }

  async function handleStart() {
    if (!locationId) { toast.error("Select a location"); return; }
    setLoading(true);
    const res = await fetch("/api/opname", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationId, notes, categoryIds }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { toast.error(data.error); return; }
    toast.success(`${data.sessionNumber} started`);
    router.push(`/opname/${data.id}`);
    router.refresh();
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors">
        + New Session
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-80 space-y-4">
            <h2 className="text-sm font-semibold text-slate-800">New Stock Opname</h2>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Location *</label>
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Select…</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Categories</label>
              <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1">
                {categories.length === 0 && <p className="text-xs text-slate-400">No categories.</p>}
                {categories.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={categoryIds.includes(c.id)}
                      onChange={(e) => toggleCategory(c.id, e.target.checked)} />
                    {c.name}
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Leave empty to count the whole warehouse.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Optional" />
            </div>
            <p className="text-xs text-slate-400">Pre-fills current stock as book values for blind counting{"."}</p>
            <div className="flex gap-2">
              <button onClick={handleStart} disabled={loading || !locationId}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold py-2 rounded-lg">
                {loading ? "Starting…" : "Start Session"}
              </button>
              <button onClick={close} className="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
