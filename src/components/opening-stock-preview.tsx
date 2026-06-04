"use client";

import type { ReactNode } from "react";
import type { ValidatedRow } from "@/lib/opening-stock";

// Shared preview of validated opening-stock rows. Used by both the CSV-import
// flow and the manual-add flow so the two can never drift. The caller supplies
// its own secondary action (e.g. "Re-upload CSV" or "Back to edit").
export function OpeningStockPreview({
  rows,
  importing,
  onConfirm,
  secondaryAction,
}: {
  rows: ValidatedRow[];
  importing: boolean;
  onConfirm: () => void;
  secondaryAction: ReactNode;
}) {
  const errorCount = rows.filter((r) => r.status === "error").length;
  const warnCount = rows.filter((r) => r.status === "warning").length;
  const skipCount = rows.filter((r) => r.status === "skip").length;
  const okCount = rows.filter((r) => r.status === "ok").length;
  const importableCount = okCount + warnCount;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">{okCount} OK</span>
        {warnCount > 0 && (
          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
            {warnCount} warning{warnCount !== 1 ? "s" : ""}
          </span>
        )}
        {skipCount > 0 && (
          <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 font-medium">
            {skipCount} skipped
          </span>
        )}
        {errorCount > 0 && (
          <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
            {errorCount} error{errorCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {errorCount > 0 && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
          {errorCount} row(s) have errors and will be skipped. Fix them and try again to include them.
        </div>
      )}

      <div className="overflow-auto border border-slate-200 rounded-lg max-h-[60vh]">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
            <tr className="text-left text-xs text-slate-500 uppercase tracking-wide">
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Unit Cost</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, i) => (
              <tr
                key={i}
                className={
                  row.status === "error"
                    ? "bg-red-50"
                    : row.status === "warning"
                    ? "bg-amber-50"
                    : row.status === "skip"
                    ? "bg-sky-50"
                    : ""
                }
              >
                <td className="px-3 py-1.5 font-mono text-xs text-slate-600">{row.sku}</td>
                <td className="px-3 py-1.5 text-slate-700">
                  {row.productName ?? <span className="text-red-400 italic">not found</span>}
                </td>
                <td className="px-3 py-1.5 text-slate-600">{row.location}</td>
                <td className="px-3 py-1.5 text-right text-slate-700">
                  {row.qty > 0 ? row.qty.toLocaleString() : "—"}
                </td>
                <td className="px-3 py-1.5 text-right text-slate-600">
                  {row.unitCost != null ? row.unitCost.toLocaleString() : "—"}
                </td>
                <td className="px-3 py-1.5">
                  {row.status === "ok" && <span className="text-green-600 text-xs font-medium">✓ OK</span>}
                  {row.status === "warning" && <span className="text-amber-600 text-xs">⚠ {row.message}</span>}
                  {row.status === "skip" && <span className="text-sky-600 text-xs">⊘ {row.message}</span>}
                  {row.status === "error" && <span className="text-red-600 text-xs">✗ {row.message}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-3">
        {secondaryAction}
        <button
          onClick={onConfirm}
          disabled={importing || importableCount === 0}
          className="px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {importing
            ? "Importing…"
            : `Confirm & Import ${importableCount} row${importableCount !== 1 ? "s" : ""}`}
        </button>
      </div>

      {warnCount > 0 && (
        <p className="text-xs text-amber-600">
          Warning rows are duplicated — the last value for each product + location wins.
        </p>
      )}
      {skipCount > 0 && (
        <p className="text-xs text-sky-600">
          {skipCount} row{skipCount !== 1 ? "s" : ""} already have stock and will be skipped — use an
          Adjustment to change an existing balance.
        </p>
      )}
    </div>
  );
}
