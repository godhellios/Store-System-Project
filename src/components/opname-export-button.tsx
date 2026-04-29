"use client";

import { useState } from "react";

type Location = { id: string; name: string };

export function OpnameExportButton({ locations }: { locations: Location[] }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"all" | "location">("all");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");

  function handleExport() {
    const params = new URLSearchParams({ scope });
    if (scope === "location" && locationId) params.set("locationId", locationId);
    window.location.href = `/api/opname/export?${params}`;
    setOpen(false);
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-base font-bold text-slate-800 mb-1">Export Opname Template</h2>
            <p className="text-xs text-slate-500 mb-4">
              Choose the export scope. Staff fill in physical counts and import the file back.
            </p>

            <div className="space-y-2 mb-5">
              {/* Option 1 — All Items */}
              <button
                type="button"
                onClick={() => setScope("all")}
                className={[
                  "w-full text-left px-4 py-3 rounded-xl border-2 transition-colors",
                  scope === "all"
                    ? "border-blue-500 bg-blue-50"
                    : "border-slate-200 hover:border-slate-300 bg-white",
                ].join(" ")}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${scope === "all" ? "border-blue-500" : "border-slate-400"}`}>
                    {scope === "all" && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 block" />}
                  </span>
                  <span className={`text-sm font-semibold ${scope === "all" ? "text-blue-700" : "text-slate-700"}`}>
                    All Items
                  </span>
                </div>
                <p className="text-xs text-slate-500 ml-5.5 pl-[22px]">
                  Export every active item from the item master, including items with no stock in any warehouse.
                </p>
              </button>

              {/* Option 2 — By Location */}
              <button
                type="button"
                onClick={() => setScope("location")}
                className={[
                  "w-full text-left px-4 py-3 rounded-xl border-2 transition-colors",
                  scope === "location"
                    ? "border-blue-500 bg-blue-50"
                    : "border-slate-200 hover:border-slate-300 bg-white",
                ].join(" ")}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${scope === "location" ? "border-blue-500" : "border-slate-400"}`}>
                    {scope === "location" && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 block" />}
                  </span>
                  <span className={`text-sm font-semibold ${scope === "location" ? "text-blue-700" : "text-slate-700"}`}>
                    By Warehouse Location
                  </span>
                </div>
                <p className="text-xs text-slate-500 pl-[22px]">
                  Export only items that exist inside a specific warehouse — items with a stock or movement record there.
                </p>

                {scope === "location" && (
                  <div className="mt-3 pl-[22px]" onClick={(e) => e.stopPropagation()}>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Select warehouse</label>
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
                )}
              </button>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleExport}
                disabled={scope === "location" && !locationId}
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
