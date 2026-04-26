"use client";

import { useRef, useState } from "react";
import Papa from "papaparse";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";

type ParsedRow = {
  name: string; sku: string; barcode: string;
  category: string; unit: string;
  reorderPoint: string; colorVariant: string; description: string;
};
type Result = { row: number; sku: string; status: "ok" | "error"; message?: string };

function generateBarcode() {
  return "MR" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
}

export default function BulkImportPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<Result[]>([]);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse<ParsedRow>(file, {
      header: true, skipEmptyLines: true,
      complete: (result) => {
        setRows(result.data);
        setResults([]);
        toast.success(`${result.data.length} rows loaded`);
      },
      error: () => toast.error("Failed to parse file"),
    });
  }

  function downloadTemplate() {
    const csv = "name,sku,barcode,category,unit,reorderPoint,colorVariant,description\n" +
      "Button #12 Black,BTN-12-BLK,MR123456,Button,Pack,50,Black,12mm black button\n" +
      "Zipper 20cm White,ZIP-20-WHT,,Zipper,Pack,20,White,\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "mris-import-template.csv"; a.click();
  }

  async function handleImport() {
    if (rows.length === 0) return;
    setImporting(true);
    setResults([]);
    const res: Result[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      // Auto-generate barcode if empty
      const barcode = row.barcode?.trim() || generateBarcode();

      // Resolve category and unit by name via API
      try {
        const [catRes, unitRes] = await Promise.all([
          fetch(`/api/categories`).then((r) => r.json()),
          fetch(`/api/units`).then((r) => r.json()),
        ]);
        const cat = catRes.find((c: { name: string; id: string }) => c.name.toLowerCase() === row.category?.trim().toLowerCase());
        const unit = unitRes.find((u: { name: string; id: string }) => u.name.toLowerCase() === row.unit?.trim().toLowerCase());

        if (!cat) { res.push({ row: i + 2, sku: row.sku, status: "error", message: `Category "${row.category}" not found` }); continue; }
        if (!unit) { res.push({ row: i + 2, sku: row.sku, status: "error", message: `Unit "${row.unit}" not found` }); continue; }

        const r = await fetch("/api/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: row.name?.trim(), sku: row.sku?.trim(), barcode,
            categoryId: cat.id, unitId: unit.id,
            reorderPoint: parseInt(row.reorderPoint) || 0,
            colorVariant: row.colorVariant?.trim() || null,
            description: row.description?.trim() || null,
          }),
        });
        const data = await r.json();
        if (r.ok) res.push({ row: i + 2, sku: row.sku, status: "ok" });
        else res.push({ row: i + 2, sku: row.sku, status: "error", message: data.error });
      } catch {
        res.push({ row: i + 2, sku: row.sku, status: "error", message: "Network error" });
      }
    }

    setImporting(false);
    setResults(res);
    const ok = res.filter((r) => r.status === "ok").length;
    const err = res.filter((r) => r.status === "error").length;
    if (err === 0) { toast.success(`All ${ok} products imported`); router.push("/products"); }
    else toast(`${ok} imported, ${err} failed`, { icon: "⚠️" });
  }

  return (
    <div>
      <h1 className="text-base font-semibold text-slate-800 mb-5">Bulk Import Products</h1>

      <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-2xl space-y-5">
        <div>
          <p className="text-sm text-slate-600 mb-3">
            Import products from a CSV file. Leave the <code className="bg-slate-100 px-1 rounded">barcode</code> column blank to auto-generate.
          </p>
          <button onClick={downloadTemplate} className="text-sm text-blue-600 hover:underline">
            ↓ Download CSV template
          </button>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-2">Select CSV file</label>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="text-sm" />
        </div>

        {rows.length > 0 && (
          <div>
            <p className="text-xs text-slate-500 mb-2">{rows.length} rows ready to import</p>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {["name", "sku", "barcode", "category", "unit", "reorderPoint"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-slate-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 10).map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-3 py-1.5">{r.name}</td>
                      <td className="px-3 py-1.5 font-mono">{r.sku}</td>
                      <td className="px-3 py-1.5 font-mono text-slate-400">{r.barcode || "(auto)"}</td>
                      <td className="px-3 py-1.5">{r.category}</td>
                      <td className="px-3 py-1.5">{r.unit}</td>
                      <td className="px-3 py-1.5">{r.reorderPoint}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 10 && <p className="text-xs text-slate-400 mt-1">…and {rows.length - 10} more rows</p>}
          </div>
        )}

        {results.length > 0 && (
          <div className="space-y-1">
            {results.filter((r) => r.status === "error").map((r) => (
              <div key={r.row} className="text-xs text-red-600 bg-red-50 px-3 py-1.5 rounded">
                Row {r.row} ({r.sku}): {r.message}
              </div>
            ))}
            <p className="text-xs text-green-600">
              ✓ {results.filter((r) => r.status === "ok").length} products imported successfully
            </p>
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={handleImport} disabled={importing || rows.length === 0}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg">
            {importing ? `Importing… (${results.length}/${rows.length})` : `Import ${rows.length} Products`}
          </button>
          <button onClick={() => router.back()} className="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
