"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import type { ValidatedRow } from "@/lib/opening-stock";
import { OpeningStockPreview } from "@/components/opening-stock-preview";

type Location = { id: string; name: string; isActive: boolean };
type PickProduct = { id: string; sku: string; name: string };
type Line = { sku: string; productName: string; location: string; qty: number; unitCost: number | null };

type Step = "build" | "preview" | "done";

export function OpeningStockManual() {
  const [step, setStep] = useState<Step>("build");
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [available, setAvailable] = useState<PickProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<PickProduct | null>(null);
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState("");

  const [lines, setLines] = useState<Line[]>([]);
  const [validatedRows, setValidatedRows] = useState<ValidatedRow[]>([]);
  const [importing, setImporting] = useState(false);

  const locationName = locations.find((l) => l.id === locationId)?.name ?? "";

  // Load active locations once.
  useEffect(() => {
    fetch("/api/locations")
      .then((r) => r.json())
      .then((data: Location[]) => setLocations(data.filter((l) => l.isActive)))
      .catch(() => toast.error("Failed to load locations"));
  }, []);

  // Load the products still needing a balance whenever the location changes.
  useEffect(() => {
    if (!locationId) {
      setAvailable([]);
      return;
    }
    setLoadingProducts(true);
    setSelected(null);
    setSearch("");
    fetch(`/api/opening-stock?locationId=${locationId}&format=json`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { products: PickProduct[] }) => setAvailable(data.products ?? []))
      .catch(() => toast.error("Failed to load products"))
      .finally(() => setLoadingProducts(false));
  }, [locationId]);

  // SKUs already on the list for this location can't be added twice.
  const usedKeys = useMemo(
    () => new Set(lines.map((l) => `${l.sku.toLowerCase()}:${l.location.toLowerCase()}`)),
    [lines],
  );

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return available
      .filter((p) => p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
      .filter((p) => !usedKeys.has(`${p.sku.toLowerCase()}:${locationName.toLowerCase()}`))
      .slice(0, 20);
  }, [search, available, usedKeys, locationName]);

  function addLine() {
    if (!selected) return;
    const n = parseInt(qty, 10);
    if (isNaN(n) || n <= 0) {
      toast.error("Enter a quantity greater than 0");
      return;
    }
    let cost: number | null = null;
    if (unitCost.trim()) {
      cost = parseFloat(unitCost);
      if (isNaN(cost) || cost <= 0) {
        toast.error("Unit cost must be a positive number");
        return;
      }
    }
    setLines((prev) => [
      ...prev,
      { sku: selected.sku, productName: selected.name, location: locationName, qty: n, unitCost: cost },
    ]);
    setSelected(null);
    setSearch("");
    setQty("");
    setUnitCost("");
  }

  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function validate() {
    const rows = lines.map((l) => ({
      sku: l.sku,
      location: l.location,
      qty: String(l.qty),
      unitCost: l.unitCost != null ? String(l.unitCost) : "",
    }));
    const toastId = toast.loading(`Validating ${rows.length} row(s)…`);
    try {
      const res = await fetch("/api/opening-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, confirm: false }),
      });
      const data = await res.json();
      setValidatedRows(data.rows);
      setStep("preview");
      const errCount = (data.rows as ValidatedRow[]).filter((r) => r.status === "error").length;
      if (errCount > 0) toast.error(`${errCount} row(s) have errors`, { id: toastId });
      else toast.success(`${data.rows.length} row(s) ready to import`, { id: toastId });
    } catch {
      toast.error("Validation failed", { id: toastId });
    }
  }

  async function handleImport() {
    setImporting(true);
    const rows = lines.map((l) => ({
      sku: l.sku,
      location: l.location,
      qty: String(l.qty),
      unitCost: l.unitCost != null ? String(l.unitCost) : "",
    }));
    try {
      const res = await fetch("/api/opening-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, confirm: true }),
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
    setStep("build");
    setLines([]);
    setValidatedRows([]);
    setSelected(null);
    setSearch("");
    setQty("");
    setUnitCost("");
  }

  // ── Done ───────────────────────────────────────────────────────────────────
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
          <button onClick={reset} className="text-sm text-slate-500 underline">Add more</button>
        </div>
      </div>
    );
  }

  // ── Preview ────────────────────────────────────────────────────────────────
  if (step === "preview") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => setStep("build")} className="text-sm text-slate-500 hover:text-slate-700">
            ← Back to edit
          </button>
          <h2 className="text-lg font-semibold text-slate-800">Preview</h2>
        </div>
        <OpeningStockPreview
          rows={validatedRows}
          importing={importing}
          onConfirm={handleImport}
          secondaryAction={
            <button
              onClick={() => setStep("build")}
              className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
            >
              ← Back to edit
            </button>
          }
        />
      </div>
    );
  }

  // ── Build ──────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl space-y-6">
      <p className="text-sm text-slate-500">
        Pick a warehouse, search a product that has no balance there yet, then add its opening quantity.
        Already-stocked products at the chosen warehouse won&apos;t appear — change those with an Adjustment.
      </p>

      <div className="space-y-1">
        <label className="text-sm font-medium text-slate-700">Warehouse</label>
        <select
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Select a warehouse…</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      </div>

      {locationId && (
        <div className="space-y-3 border border-slate-200 rounded-lg p-4">
          <p className="text-sm font-medium text-slate-700">
            Add a product{loadingProducts ? " (loading…)" : ` (${available.length} available)`}
          </p>

          {!selected ? (
            <div className="relative">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by SKU or name…"
                className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              {matches.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full max-h-60 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                  {matches.map((p) => (
                    <li key={p.id}>
                      <button
                        onClick={() => { setSelected(p); setSearch(""); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-sky-50"
                      >
                        <span className="font-mono text-xs text-slate-500">{p.sku}</span>
                        <span className="text-slate-700"> — {p.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[180px]">
                <span className="text-xs text-slate-500">Product</span>
                <div className="text-sm text-slate-800">
                  <span className="font-mono text-xs text-slate-500">{selected.sku}</span> — {selected.name}
                  <button onClick={() => setSelected(null)} className="ml-2 text-xs text-slate-400 underline">change</button>
                </div>
              </div>
              <div>
                <span className="text-xs text-slate-500">Qty</span>
                <input
                  type="number" min={1} value={qty}
                  onFocus={(e) => e.target.select()} onChange={(e) => setQty(e.target.value)}
                  className="block w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  autoFocus
                />
              </div>
              <div>
                <span className="text-xs text-slate-500">Unit cost (optional)</span>
                <input
                  type="number" min={0} step="any" value={unitCost}
                  onFocus={(e) => e.target.select()} onChange={(e) => setUnitCost(e.target.value)}
                  className="block w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <button
                onClick={addLine}
                className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-900 transition-colors"
              >
                Add
              </button>
            </div>
          )}
        </div>
      )}

      {lines.length > 0 && (
        <div className="space-y-3">
          <div className="overflow-auto border border-slate-200 rounded-lg">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left text-xs text-slate-500 uppercase tracking-wide">
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">Warehouse</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Unit Cost</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5 font-mono text-xs text-slate-600">{l.sku}</td>
                    <td className="px-3 py-1.5 text-slate-700">{l.productName}</td>
                    <td className="px-3 py-1.5 text-slate-600">{l.location}</td>
                    <td className="px-3 py-1.5 text-right text-slate-700">{l.qty.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right text-slate-600">
                      {l.unitCost != null ? l.unitCost.toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <button onClick={() => removeLine(i)} className="text-xs text-red-500 hover:underline">remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            onClick={validate}
            className="px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 transition-colors"
          >
            Review {lines.length} row{lines.length !== 1 ? "s" : ""} →
          </button>
        </div>
      )}
    </div>
  );
}
