"use client";

import { useRef, useState } from "react";
import Papa from "papaparse";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";
import type { ClassifiedRow, PreviewSummary } from "@/app/api/products/import/preview/route";
import type { ApplyResult } from "@/app/api/products/import/apply/route";

type RawRow = Record<string, string>;
type Step = "upload" | "preview" | "done";

const ACTION_BADGE: Record<string, { label: string; cls: string }> = {
  create:         { label: "New",          cls: "bg-green-100 text-green-700" },
  update:         { label: "Update",       cls: "bg-blue-100 text-blue-700" },
  link:           { label: "Link",         cls: "bg-cyan-100 text-cyan-700" },
  conflict:       { label: "Conflict",     cls: "bg-amber-100 text-amber-700" },
  file_duplicate: { label: "Dup in file",  cls: "bg-red-100 text-red-700" },
  invalid:        { label: "Invalid",      cls: "bg-slate-100 text-slate-500" },
};

const RESULT_BADGE: Record<string, string> = {
  ok:      "bg-green-100 text-green-700",
  skipped: "bg-slate-100 text-slate-500",
  error:   "bg-red-100 text-red-600",
};

export default function BulkImportPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [rawRows, setRawRows] = useState<RawRow[]>([]);
  const [classified, setClassified] = useState<ClassifiedRow[]>([]);
  const [summary, setSummary] = useState<PreviewSummary | null>(null);
  const [decisions, setDecisions] = useState<Record<number, "create" | "skip">>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<ApplyResult[]>([]);
  const [resultSummary, setResultSummary] = useState<{ ok: number; skipped: number; errors: number } | null>(null);

  function downloadTemplate() {
    const csv =
      "name,sku,barcode,category,unit,reorderPoint,colorVariant,description\n" +
      "Button #12 Black,BTN-12-BLK,MR123456,Button,Pack,50,Black,12mm black button\n" +
      "Zipper 20cm White,ZIP-20-WHT,,Zipper,Pack,20,White,\n";
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })),
      download: "mris-import-template.csv",
    });
    a.click();
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse<RawRow>(file, {
      header: true, skipEmptyLines: true,
      complete: (r) => { setRawRows(r.data); toast.success(`${r.data.length} rows loaded`); },
      error: () => toast.error("Failed to parse file"),
    });
  }

  async function handleAnalyze() {
    if (!rawRows.length) return;
    setAnalyzing(true);
    try {
      const res = await fetch("/api/products/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rawRows }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error); return; }
      setClassified(data.classified);
      setSummary(data.summary);
      // Default: conflicts are skipped
      const d: Record<number, "create" | "skip"> = {};
      data.classified.filter((r: ClassifiedRow) => r.action === "conflict").forEach((r: ClassifiedRow) => { d[r.index] = "skip"; });
      setDecisions(d);
      setStep("preview");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleApply() {
    setApplying(true);
    try {
      const res = await fetch("/api/products/import/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: classified, conflictDecisions: decisions }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error); return; }
      setResults(data.results);
      setResultSummary({ ok: data.ok, skipped: data.skipped, errors: data.errors });
      setStep("done");
      if (data.errors === 0) toast.success(`Import complete — ${data.ok} processed`);
      else toast(`${data.ok} ok, ${data.errors} failed`, { icon: "⚠️" });
    } finally {
      setApplying(false);
    }
  }

  const conflictRows = classified.filter((r) => r.action === "conflict");
  const canApply = summary && (summary.create + summary.update + summary.link + summary.conflict) > 0;

  // ── Upload step ──────────────────────────────────────────────────────────
  if (step === "upload") return (
    <div>
      <h1 className="text-base font-semibold text-slate-800 mb-5">Bulk Import Products</h1>
      <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-2xl space-y-5">
        <div>
          <p className="text-sm text-slate-600 mb-2">
            Import products from a CSV file. The system will check for duplicates before saving.
          </p>
          <button onClick={downloadTemplate} className="text-sm text-blue-600 hover:underline">
            ↓ Download CSV template
          </button>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-2">Select CSV file</label>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="text-sm" />
        </div>
        {rawRows.length > 0 && (
          <div>
            <p className="text-xs text-slate-500 mb-2">{rawRows.length} rows loaded</p>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {["name", "sku", "barcode", "category", "unit"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-slate-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rawRows.slice(0, 8).map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-3 py-1.5">{r.name}</td>
                      <td className="px-3 py-1.5 font-mono">{r.sku}</td>
                      <td className="px-3 py-1.5 font-mono text-slate-400">{r.barcode || "(auto)"}</td>
                      <td className="px-3 py-1.5">{r.category}</td>
                      <td className="px-3 py-1.5">{r.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rawRows.length > 8 && <p className="text-xs text-slate-400 mt-1">…and {rawRows.length - 8} more rows</p>}
          </div>
        )}
        <div className="flex gap-3">
          <button onClick={handleAnalyze} disabled={analyzing || rawRows.length === 0}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg">
            {analyzing ? "Analyzing…" : `Analyze ${rawRows.length} Rows`}
          </button>
          <button onClick={() => router.back()} className="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

  // ── Preview step ─────────────────────────────────────────────────────────
  if (step === "preview" && summary) return (
    <div>
      <h1 className="text-base font-semibold text-slate-800 mb-5">Import Preview</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {[
          { label: "Total rows",   value: summary.total,         cls: "bg-slate-50 border-slate-200 text-slate-700" },
          { label: "New items",    value: summary.create,        cls: "bg-green-50 border-green-200 text-green-700" },
          { label: "Updates",      value: summary.update + summary.link, cls: "bg-blue-50 border-blue-200 text-blue-700" },
          { label: "Conflicts",    value: summary.conflict,      cls: "bg-amber-50 border-amber-200 text-amber-700" },
          { label: "File dups",    value: summary.fileDuplicate, cls: "bg-red-50 border-red-200 text-red-700" },
          { label: "Invalid",      value: summary.invalid,       cls: "bg-slate-50 border-slate-300 text-slate-500" },
        ].map(({ label, value, cls }) => (
          <div key={label} className={`rounded-xl border px-4 py-3 ${cls}`}>
            <div className="text-2xl font-bold">{value}</div>
            <div className="text-[11px] font-medium mt-0.5 opacity-80">{label}</div>
          </div>
        ))}
      </div>

      {/* Conflict resolution */}
      {conflictRows.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5">
          <h2 className="text-sm font-semibold text-amber-800 mb-3">
            ⚠ {conflictRows.length} conflict{conflictRows.length !== 1 ? "s" : ""} — review before importing
          </h2>
          <div className="space-y-3">
            {conflictRows.map((r) => (
              <div key={r.index} className="bg-white rounded-lg border border-amber-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                  <div>
                    <span className="text-sm font-semibold text-slate-800">{r.raw.name}</span>
                    <span className="ml-2 text-xs font-mono text-slate-500">{r.raw.sku}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setDecisions((d) => ({ ...d, [r.index]: "skip" }))}
                      className={`px-3 py-1 text-xs rounded-lg border font-medium transition-colors ${decisions[r.index] === "skip" ? "bg-slate-600 text-white border-slate-600" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}
                    >
                      Skip
                    </button>
                    <button
                      onClick={() => setDecisions((d) => ({ ...d, [r.index]: "create" }))}
                      className={`px-3 py-1 text-xs rounded-lg border font-medium transition-colors ${decisions[r.index] === "create" ? "bg-green-600 text-white border-green-600" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}
                    >
                      Create as new
                    </button>
                  </div>
                </div>
                <p className="text-xs text-amber-700">
                  Existing item: <span className="font-semibold">{r.existingProduct?.name}</span>{" "}
                  <span className="font-mono">(SKU: {r.existingProduct?.sku})</span>
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All rows table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-5">
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2 text-left font-medium text-slate-500 w-10">#</th>
                <th className="px-3 py-2 text-left font-medium text-slate-500">Name</th>
                <th className="px-3 py-2 text-left font-medium text-slate-500">SKU</th>
                <th className="px-3 py-2 text-left font-medium text-slate-500">Category</th>
                <th className="px-3 py-2 text-left font-medium text-slate-500">Status</th>
                <th className="px-3 py-2 text-left font-medium text-slate-500">Note</th>
              </tr>
            </thead>
            <tbody>
              {classified.map((r) => {
                const badge = ACTION_BADGE[r.action] ?? ACTION_BADGE.invalid;
                const rowCls = r.blocked ? "opacity-50" : r.action === "conflict" ? "bg-amber-50" : "";
                return (
                  <tr key={r.index} className={`border-t border-slate-100 ${rowCls}`}>
                    <td className="px-3 py-1.5 text-slate-400">{r.index + 2}</td>
                    <td className="px-3 py-1.5 font-medium text-slate-800 max-w-[180px] truncate">{r.raw.name || "—"}</td>
                    <td className="px-3 py-1.5 font-mono text-slate-500">{r.raw.sku || <span className="italic text-slate-300">empty</span>}</td>
                    <td className="px-3 py-1.5 text-slate-500">{r.raw.category || "—"}</td>
                    <td className="px-3 py-1.5">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-slate-400 max-w-[240px] truncate">
                      {r.issues.length > 0 ? r.issues[0] : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex gap-3 items-center">
        <button onClick={handleApply} disabled={applying || !canApply}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg">
          {applying ? "Applying…" : "Confirm & Import"}
        </button>
        <button onClick={() => { setStep("upload"); setRawRows([]); if (fileRef.current) fileRef.current.value = ""; }}
          className="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
          ← Back
        </button>
        <p className="text-xs text-slate-400">
          {(summary.create + summary.update + summary.link)} rows will be processed
          {summary.conflict > 0 && `, ${Object.values(decisions).filter((v) => v === "create").length} conflict(s) marked as new`}
        </p>
      </div>
    </div>
  );

  // ── Done step ────────────────────────────────────────────────────────────
  if (step === "done" && resultSummary) return (
    <div>
      <h1 className="text-base font-semibold text-slate-800 mb-5">Import Complete</h1>
      <div className="grid grid-cols-3 gap-3 mb-6 max-w-md">
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <div className="text-2xl font-bold text-green-700">{resultSummary.ok}</div>
          <div className="text-[11px] font-medium text-green-600 mt-0.5">Processed</div>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
          <div className="text-2xl font-bold text-slate-600">{resultSummary.skipped}</div>
          <div className="text-[11px] font-medium text-slate-500 mt-0.5">Skipped</div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <div className="text-2xl font-bold text-red-600">{resultSummary.errors}</div>
          <div className="text-[11px] font-medium text-red-500 mt-0.5">Errors</div>
        </div>
      </div>

      {results.filter((r) => r.status !== "ok").length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-5">
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Skipped / Errors
          </div>
          <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {results.filter((r) => r.status !== "ok").map((r) => (
              <div key={r.index} className="flex items-center gap-3 px-4 py-2">
                <span className="text-xs text-slate-400 w-10">Row {r.index + 2}</span>
                <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${RESULT_BADGE[r.status]}`}>
                  {r.status}
                </span>
                <span className="text-xs text-slate-500">{r.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={() => router.push("/products")}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-5 py-2 rounded-lg">
          View Products
        </button>
        <button onClick={() => { setStep("upload"); setRawRows([]); setClassified([]); setSummary(null); setResults([]); if (fileRef.current) fileRef.current.value = ""; }}
          className="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
          Import Another File
        </button>
      </div>
    </div>
  );

  return null;
}
