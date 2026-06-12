"use client";

import { useState } from "react";
import { useT } from "@/modules/i18n/provider";

type Category = { id: string; name: string };

export function BarcodeSheetPanel({ categories }: { categories: Category[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [search, setSearch] = useState("");
  const [includeUnits, setIncludeUnits] = useState(false);

  function openSheet() {
    if (!categoryId) return;
    const params = new URLSearchParams({ categoryId });
    if (search.trim()) params.set("search", search.trim());
    if (includeUnits) params.set("units", "1");
    // (print) is a route group — it does NOT appear in the URL.
    window.open(`/barcodes/sheet?${params.toString()}`, "_blank");
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mb-4 flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 hover:border-slate-300 transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        {t("barcodes.sheet.openButton", "Print A4 Sheet")}
      </button>
    );
  }

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-800">{t("barcodes.sheet.title", "Print A4 Barcode Sheet")}</h3>
        <button
          onClick={() => setOpen(false)}
          className="text-slate-400 hover:text-slate-600 text-lg leading-none"
          aria-label={t("barcodes.sheet.close", "Close")}
        >
          ×
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        {/* Category */}
        <div className="flex-1 min-w-0">
          <label className="block text-xs font-medium text-slate-600 mb-1">{t("barcodes.sheet.category", "Category")}</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="">{t("barcodes.sheet.pickCategory", "— Select category —")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* Search filter */}
        <div className="flex-1 min-w-0">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            {t("barcodes.sheet.filterName", "Name filter")}{" "}
            <span className="text-slate-400 font-normal">{t("barcodes.sheet.optional", "(optional)")}</span>
          </label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && openSheet()}
            placeholder={t("barcodes.sheet.filterPlaceholder", "e.g. Yamalon")}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
      </div>

      {/* Include packing barcodes */}
      <label className="mt-3 flex items-center gap-2 cursor-pointer select-none w-fit">
        <input
          type="checkbox"
          checked={includeUnits}
          onChange={(e) => setIncludeUnits(e.target.checked)}
          className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
        />
        <span className="text-sm text-slate-700">
          {t("barcodes.sheet.includeUnits", "Include packing unit barcodes")}{" "}
          <span className="text-slate-400">{t("barcodes.sheet.includeUnitsHint", "(Box, Lusin, etc.)")}</span>
        </span>
      </label>

      {/* Open Sheet button */}
      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={openSheet}
          disabled={!categoryId}
          className="px-5 py-2 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {t("barcodes.sheet.open", "Open Sheet")}
        </button>
        <span className="text-xs text-slate-400">
          {t("barcodes.sheet.hint", "Opens a new tab → Ctrl+P to print")}
        </span>
      </div>
    </div>
  );
}
