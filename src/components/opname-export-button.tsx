"use client";

import { useState } from "react";

type Location = { id: string; name: string };
type Category = { id: string; name: string };

export function OpnameExportButton({
  locations,
  categories,
}: {
  locations: Location[];
  categories: Category[];
}) {
  const [open, setOpen] = useState(false);
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [onlyStocked, setOnlyStocked] = useState(false);

  function toggleCategory(id: string, checked: boolean) {
    setCategoryIds((prev) => (checked ? [...prev, id] : prev.filter((c) => c !== id)));
  }

  function close() {
    setOpen(false);
    setCategoryIds([]);
    setOnlyStocked(false);
  }

  function handleExport() {
    const params = new URLSearchParams();
    if (locationId) params.set("locationId", locationId);
    if (categoryIds.length) params.set("categoryIds", categoryIds.join(","));
    if (onlyStocked) params.set("onlyStocked", "1");
    window.location.href = `/api/opname/export?${params}`;
    close();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        </svg>
        Export Template
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <h2 className="text-base font-bold text-slate-800 mb-1">Export Opname Template</h2>
            <p className="text-xs text-slate-500 mb-4">
              Pick a warehouse and (optionally) categories. Staff fill in physical counts and import the file back.
            </p>

            {/* Warehouse */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-slate-600 mb-1">Warehouse *</label>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>

            {/* Categories */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-slate-600 mb-1">Categories</label>
              <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1">
                {categories.length === 0 && <p className="text-xs text-slate-400">No categories.</p>}
                {categories.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={categoryIds.includes(c.id)}
                      onChange={(e) => toggleCategory(c.id, e.target.checked)}
                    />
                    {c.name}
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Leave empty for all categories.</p>
            </div>

            {/* Which items */}
            <div className="mb-5 space-y-2">
              <label className="block text-xs font-medium text-slate-600">Which items</label>
              <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name="itemScope"
                  checked={!onlyStocked}
                  onChange={() => setOnlyStocked(false)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">All active items</span>
                  <span className="block text-[11px] text-slate-400">Includes new items and items with no stock here yet (recommended).</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name="itemScope"
                  checked={onlyStocked}
                  onChange={() => setOnlyStocked(true)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">Only items stocked in this warehouse</span>
                  <span className="block text-[11px] text-slate-400">Shorter list — items with a stock or movement record here.</span>
                </span>
              </label>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={close}
                className="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleExport}
                disabled={!locationId}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                Download .xlsx
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
