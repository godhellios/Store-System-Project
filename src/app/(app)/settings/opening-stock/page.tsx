"use client";

import { useRef, useState } from "react";
import Papa from "papaparse";
import toast from "react-hot-toast";
import type { ValidatedRow } from "@/lib/opening-stock";

type Step = "upload" | "preview" | "done";
type RawRow = Record<string, string>;

export default function OpeningStockPage() {
  const [step, setStep] = useState<Step>("upload");
  const [validatedRows, setValidatedRows] = useState<ValidatedRow[]>([]);
  const [rawParsed, setRawParsed] = useState<{ sku: string; location: string; qty: string; unitCost: string }[]>([]);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function downloadTemplate() {
    const res = await fetch("/api/opening-stock", { cache: "no-store" });
    if (!res.ok) { toast.error("Failed to generate template"); return; }
    const blob = await res.blob();
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: "opening-stock-template.csv",
    });
    a.click();
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    Papa.parse<RawRow>(file, {
      header: true,
      skipEmptyLines: true,
      comments: "#",
      complete: async (result) => {
        const parsed = result.data
          .map((row) => ({
            sku: (row.SKU ?? row.sku ?? "").trim(),
            location: (row.Location ?? row.location ?? "").trim(),
            qty: (row.Qty ?? row.qty ?? "").trim(),
            unitCost: (row.UnitCost ?? row.unitcost ?? row.unit_cost ?? "").trim(),
          }))
          .filter((r) => r.qty !== "" && r.qty !== "0"); // skip blank/zero rows

        if (parsed.length === 0) {
          toast.error("No filled rows found. Fill in Location and Qty columns, then re-upload.");
          return;
        }

        setRawParsed(parsed);
        const toastId = toast.loading(`Validating ${parsed.length} rows…`);

        try {
          const res = await fetch("/api/opening-stock", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows: parsed, confirm: false }),
          });
          const data = await res.json();
          setValidatedRows(data.rows);
          setStep("preview");

          const errCount = (data.rows as ValidatedRow[]).filter((r) => r.status === "error").length;
          if (errCount > 0) {
            toast.error(`${errCount} row(s) have errors — fix and re-upload`, { id: toastId });
          } else {
            toast.success(`${data.rows.length} row(s) ready to import`, { id: toastId });
          }
        } catch {
          toast.error("Validation failed", { id: toastId });
        }
      },
    });
  }

  async function handleImport() {
    setImporting(true);
    try {
      const res = await fetch("/api/opening-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rawParsed, confirm: true }),
      });
      const data = await res.json();
      if (!res.ok || data.hasErrors) {
        toast.error(data.error ?? "Import failed — re-validate and try again");
        return;
      }
      if (data.imported === 0) {
        toast("No new balances imported — every row already had stock.", { icon: "ℹ️" });
      } else {
        toast.success(`Imported ${data.imported} stock entries`);
      }
      setStep("done");
    } catch {
      toast.error("Import failed");
    } finally {
      setImporting(false);
    }
  }

  function reset() {
    setStep("upload");
    setValidatedRows([]);
    setRawParsed([]);
  }

  const errorCount = validatedRows.filter((r) => r.status === "error").length;
  const warnCount = validatedRows.filter((r) => r.status === "warning").length;
  const skipCount = validatedRows.filter((r) => r.status === "skip").length;
  const okCount = validatedRows.filter((r) => r.status === "ok").length;
  const importableCount = okCount + warnCount;

  // ── Done ─────────────────────────────────────────────────────────────────

  if (step === "done") {
    return (
      <div className="p-6 max-w-lg space-y-3">
        <div className="text-green-600 text-lg font-semibold">Opening stock imported</div>
        <p className="text-sm text-slate-600">
          Stock has been seeded. All future stock changes should go through normal transactions
          (GRN, Goods Out, Adjustment, etc.).
        </p>
        <div className="flex gap-3 pt-2">
          <a href="/warehouse" className="text-sm text-sky-600 underline">View warehouse stock →</a>
          <button onClick={reset} className="text-sm text-slate-500 underline">Run another import</button>
        </div>
      </div>
    );
  }

  // ── Preview ───────────────────────────────────────────────────────────────

  if (step === "preview") {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={reset} className="text-sm text-slate-500 hover:text-slate-700">
            ← Back
          </button>
          <h1 className="text-lg font-semibold text-slate-800">Preview</h1>
        </div>

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
            {errorCount} row(s) have errors and will be skipped. Fix them in the CSV and re-upload to include them.
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
              {validatedRows.map((row, i) => (
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
                    {row.productName ?? (
                      <span className="text-red-400 italic">not found</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-slate-600">{row.location}</td>
                  <td className="px-3 py-1.5 text-right text-slate-700">
                    {row.qty > 0 ? row.qty.toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right text-slate-600">
                    {row.unitCost != null ? row.unitCost.toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-1.5">
                    {row.status === "ok" && (
                      <span className="text-green-600 text-xs font-medium">✓ OK</span>
                    )}
                    {row.status === "warning" && (
                      <span className="text-amber-600 text-xs">⚠ {row.message}</span>
                    )}
                    {row.status === "skip" && (
                      <span className="text-sky-600 text-xs">⊘ {row.message}</span>
                    )}
                    {row.status === "error" && (
                      <span className="text-red-600 text-xs">✗ {row.message}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap gap-3">
          <label className="cursor-pointer inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
            ↑ Re-upload CSV
            <input type="file" accept=".csv" className="hidden" onChange={handleFile} />
          </label>
          <button
            onClick={handleImport}
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
            Warning rows are duplicated in the file — the last value for each product + location wins.
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

  // ── Upload ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Opening Stock Import</h1>
        <p className="mt-1 text-sm text-slate-500">
          One-time setup to seed initial stock quantities. After this, use normal transactions
          (GRN, Adjustment, etc.) for all stock changes.
        </p>
      </div>

      <ol className="space-y-6">
        <li className="flex gap-4">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-sky-100 text-sky-700 text-sm font-bold flex items-center justify-center">
            1
          </span>
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Download template</p>
            <p className="text-sm text-slate-500">
              Lists only products that have no stock yet — already-stocked products are left out
              (change those with an Adjustment). Open in Google Sheets or Excel.
            </p>
            <button
              onClick={downloadTemplate}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
            >
              ↓ Download CSV Template
            </button>
          </div>
        </li>

        <li className="flex gap-4">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-sky-100 text-sky-700 text-sm font-bold flex items-center justify-center">
            2
          </span>
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-700">Fill in the spreadsheet</p>
            <p className="text-sm text-slate-500">
              For each product with stock, fill in <strong>Location</strong> and <strong>Qty</strong>.
              Leave rows blank for products with no stock — they will be skipped automatically.
            </p>
            <p className="text-sm text-slate-500">
              <strong>UnitCost</strong> is optional. If provided, the product's average cost will be updated.
            </p>
            <p className="text-sm text-slate-500">
              If a product is in multiple locations, duplicate the row and fill each separately.
            </p>
          </div>
        </li>

        <li className="flex gap-4">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-sky-100 text-sky-700 text-sm font-bold flex items-center justify-center">
            3
          </span>
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Upload and import</p>
            <p className="text-sm text-slate-500">
              Save as CSV, then upload. You will see a preview before anything is saved.
            </p>
            <label className="cursor-pointer inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 transition-colors">
              ↑ Upload CSV
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFile}
                ref={fileRef}
              />
            </label>
          </div>
        </li>
      </ol>

      <div className="border border-amber-200 bg-amber-50 rounded-lg p-4 text-sm text-amber-700">
        <strong>Note:</strong> Opening stock is first-time-only. Any product + location that already
        has a balance is skipped, never overwritten — change existing balances with an Adjustment.
        This page is admin-only and intended for initial setup only.
      </div>
    </div>
  );
}
