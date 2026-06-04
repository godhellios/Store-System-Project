"use client";

import { useEffect, useRef, useState } from "react";
import Papa from "papaparse";
import toast from "react-hot-toast";
import type { ValidatedRow } from "@/lib/opening-stock";
import { OpeningStockPreview } from "@/components/opening-stock-preview";
import { OpeningStockManual } from "@/components/opening-stock-manual";

type Tab = "csv" | "manual";
type Step = "upload" | "preview" | "done";
type RawRow = Record<string, string>;
type Location = { id: string; name: string; isActive: boolean };

export default function OpeningStockPage() {
  const [tab, setTab] = useState<Tab>("csv");

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Opening Stock</h1>
        <p className="mt-1 text-sm text-slate-500">
          One-time setup to seed initial stock balances. After this, use normal transactions
          (GRN, Adjustment, etc.) for all stock changes.
        </p>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {(["csv", "manual"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === t
                ? "border-sky-600 text-sky-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t === "csv" ? "Import CSV" : "Add manually"}
          </button>
        ))}
      </div>

      {tab === "csv" ? <CsvImport /> : <OpeningStockManual />}
    </div>
  );
}

// ── CSV import flow ──────────────────────────────────────────────────────────

function CsvImport() {
  const [step, setStep] = useState<Step>("upload");
  const [validatedRows, setValidatedRows] = useState<ValidatedRow[]>([]);
  const [rawParsed, setRawParsed] = useState<{ sku: string; location: string; qty: string; unitCost: string }[]>([]);
  const [importing, setImporting] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/locations")
      .then((r) => r.json())
      .then((data: Location[]) => setLocations(data.filter((l) => l.isActive)))
      .catch(() => toast.error("Failed to load locations"));
  }, []);

  async function downloadTemplate() {
    if (!locationId) { toast.error("Choose a warehouse first"); return; }
    const res = await fetch(`/api/opening-stock?locationId=${locationId}`, { cache: "no-store" });
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
          .filter((r) => r.qty !== "" && r.qty !== "0");

        if (parsed.length === 0) {
          toast.error("No filled rows found. Fill in Qty (and Location), then re-upload.");
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
          if (errCount > 0) toast.error(`${errCount} row(s) have errors — fix and re-upload`, { id: toastId });
          else toast.success(`${data.rows.length} row(s) ready to import`, { id: toastId });
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
      if (data.imported === 0) toast("No new balances imported — every row already had stock.", { icon: "ℹ️" });
      else toast.success(`Imported ${data.imported} stock entries`);
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

  if (step === "done") {
    return (
      <div className="max-w-lg space-y-3">
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

  if (step === "preview") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={reset} className="text-sm text-slate-500 hover:text-slate-700">← Back</button>
          <h2 className="text-lg font-semibold text-slate-800">Preview</h2>
        </div>
        <OpeningStockPreview
          rows={validatedRows}
          importing={importing}
          onConfirm={handleImport}
          secondaryAction={
            <label className="cursor-pointer inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
              ↑ Re-upload CSV
              <input type="file" accept=".csv" className="hidden" onChange={handleFile} />
            </label>
          }
        />
      </div>
    );
  }

  // ── Upload ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-xl space-y-8">
      <ol className="space-y-6">
        <li className="flex gap-4">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-sky-100 text-sky-700 text-sm font-bold flex items-center justify-center">1</span>
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Pick a warehouse and download its template</p>
            <p className="text-sm text-slate-500">
              The template lists only products with no stock at the chosen warehouse, with the Location
              column pre-filled. Already-stocked products are left out — change those with an Adjustment.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Select a warehouse…</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
              <button
                onClick={downloadTemplate}
                disabled={!locationId}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                ↓ Download CSV Template
              </button>
            </div>
          </div>
        </li>

        <li className="flex gap-4">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-sky-100 text-sky-700 text-sm font-bold flex items-center justify-center">2</span>
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-700">Fill in the spreadsheet</p>
            <p className="text-sm text-slate-500">
              For each product with stock, fill in <strong>Qty</strong>. The <strong>Location</strong> is
              already filled in for you. Leave a row blank to skip it.
            </p>
            <p className="text-sm text-slate-500">
              <strong>UnitCost</strong> is optional. If provided, the product&apos;s average cost is updated.
            </p>
          </div>
        </li>

        <li className="flex gap-4">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-sky-100 text-sky-700 text-sm font-bold flex items-center justify-center">3</span>
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Upload and import</p>
            <p className="text-sm text-slate-500">Save as CSV, then upload. You&apos;ll see a preview before anything is saved.</p>
            <label className="cursor-pointer inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 transition-colors">
              ↑ Upload CSV
              <input type="file" accept=".csv" className="hidden" onChange={handleFile} ref={fileRef} />
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
