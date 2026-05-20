"use client";

import { useState, useMemo } from "react";

type UnitConversion = { id: string; name: string; conversionFactor: number; barcode: string | null };
type Product = { id: string; name: string; sku: string; barcode: string; colorVariant: string | null; isActive: boolean; categoryId: string; category: { name: string }; unit: { name: string }; unitConversions: UnitConversion[] };
type Category = { id: string; name: string };

function allBarcodeKeys(p: Product): Set<string> {
  return new Set(["base", ...(p.unitConversions ?? []).filter((uc) => uc.barcode).map((uc) => uc.id)]);
}

export function BarcodePrintPanel({
  products: allProducts,
  categories,
  preselect,
  initialCopies = {},
}: {
  products: Product[];
  categories: Category[];
  preselect: string[];
  initialCopies?: Record<string, number>;
}) {
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState("");

  const [queue, setQueue] = useState<Map<string, Product>>(
    new Map(allProducts.filter((p) => preselect.includes(p.id)).map((p) => [p.id, p]))
  );
  const [selectedBarcodes, setSelectedBarcodes] = useState<Map<string, Set<string>>>(
    new Map(allProducts.filter((p) => preselect.includes(p.id)).map((p) => [p.id, allBarcodeKeys(p)]))
  );
  const [copies, setCopies] = useState<Record<string, number>>(initialCopies);

  const searchResults = useMemo(() => {
    const term = q.trim().toLowerCase();
    return allProducts.filter((p) => {
      if (categoryId && p.categoryId !== categoryId) return false;
      if (!term) return true;
      return (
        p.name.toLowerCase().includes(term) ||
        p.sku.toLowerCase().includes(term) ||
        p.barcode.toLowerCase().includes(term) ||
        (p.colorVariant ?? "").toLowerCase().includes(term)
      );
    });
  }, [allProducts, q, categoryId]);

  function toggleQueue(p: Product) {
    setQueue((prev) => {
      const next = new Map(prev);
      next.has(p.id) ? next.delete(p.id) : next.set(p.id, p);
      return next;
    });
    setSelectedBarcodes((prev) => {
      const next = new Map(prev);
      if (next.has(p.id)) {
        next.delete(p.id);
      } else {
        next.set(p.id, allBarcodeKeys(p));
      }
      return next;
    });
  }

  function removeFromQueue(p: Product) {
    setQueue((prev) => { const next = new Map(prev); next.delete(p.id); return next; });
    setSelectedBarcodes((prev) => { const next = new Map(prev); next.delete(p.id); return next; });
  }

  function toggleBarcode(productId: string, key: string) {
    setSelectedBarcodes((prev) => {
      const next = new Map(prev);
      const keys = new Set(prev.get(productId) ?? []);
      keys.has(key) ? keys.delete(key) : keys.add(key);
      next.set(productId, keys);
      return next;
    });
  }

  function isBarcodeSelected(productId: string, key: string) {
    return selectedBarcodes.get(productId)?.has(key) ?? false;
  }

  function getCopies(id: string) { return copies[id] ?? 1; }
  function setCopy(id: string, n: number) { setCopies((c) => ({ ...c, [id]: Math.max(1, n) })); }

  const selectedProducts = [...queue.values()];

  const totalLabels = selectedProducts.reduce((sum, p) => {
    const sel = selectedBarcodes.get(p.id) ?? new Set();
    return sum + getCopies(p.id) * sel.size;
  }, 0);

  function printLabels() {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const labels = selectedProducts.flatMap((p) => {
      const n = getCopies(p.id);
      const sel = selectedBarcodes.get(p.id) ?? new Set();
      const batch: string[] = [];

      if (sel.has("base")) {
        batch.push(`
          <div class="label">
            <img src="/api/barcodes/${encodeURIComponent(p.barcode)}" alt="${p.barcode}" class="barcode-img" />
            <div class="barcode-num">${p.barcode}</div>
            <div class="product-name">${p.name}${p.colorVariant ? ` — ${p.colorVariant}` : ""}</div>
            <div class="unit">${p.unit?.name ?? ""} · ${p.sku}</div>
          </div>
        `);
      }
      for (const uc of (p.unitConversions ?? [])) {
        if (!uc.barcode || !sel.has(uc.id)) continue;
        batch.push(`
          <div class="label">
            <img src="/api/barcodes/${encodeURIComponent(uc.barcode!)}" alt="${uc.barcode}" class="barcode-img" />
            <div class="barcode-num">${uc.barcode}</div>
            <div class="product-name">${p.name}${p.colorVariant ? ` — ${p.colorVariant}` : ""}</div>
            <div class="unit">${uc.name} (×${uc.conversionFactor}) · ${p.sku}</div>
          </div>
        `);
      }
      return Array.from({ length: n }, () => [...batch]).flat();
    }).join("");

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Barcode Labels — MRIs</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; background: #fff; }
          @page { size: 56mm 40mm; margin: 0; }
          html, body { width: 56mm; margin: 0; padding: 0; }
          .label { width: 56mm; height: 40mm; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2mm; gap: 1mm; overflow: hidden; page-break-after: always; break-after: page; }
          .label:last-child { page-break-after: avoid; break-after: avoid; }
          .barcode-img { display: block; width: 50mm; height: auto; flex-shrink: 0; margin: 0 auto; }
          .barcode-num { display: block; font-family: monospace; font-size: 6.5pt; color: #333; letter-spacing: 0.5px; text-align: center; width: 52mm; flex-shrink: 0; }
          .product-name { display: block; font-size: 7.5pt; font-weight: 700; text-align: center; width: 52mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .unit { display: block; font-size: 6.5pt; color: #555; width: 52mm; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
        </style>
      </head>
      <body>${labels}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 500);
  }

  return (
    <div className="flex flex-col md:flex-row gap-5">
      {/* Product search list */}
      <div className="flex-1">
        <div className="flex gap-2 mb-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type to search products…"
            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All Categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2 text-xs text-slate-500">
            <span>{searchResults.length} result{searchResults.length !== 1 ? "s" : ""}</span>
            {searchResults.length > 0 && (
              <>
                <span>·</span>
                <button
                  onClick={() => {
                    setQueue((prev) => {
                      const next = new Map(prev);
                      searchResults.forEach((p) => next.set(p.id, p));
                      return next;
                    });
                    setSelectedBarcodes((prev) => {
                      const next = new Map(prev);
                      searchResults.forEach((p) => { if (!next.has(p.id)) next.set(p.id, allBarcodeKeys(p)); });
                      return next;
                    });
                  }}
                  className="hover:text-blue-600 font-medium"
                >
                  Select all
                </button>
              </>
            )}
            <span>·</span>
            <button onClick={() => { setQueue(new Map()); setSelectedBarcodes(new Map()); }} className="hover:text-red-600">Clear queue</button>
          </div>
          <div className="max-h-[480px] overflow-y-auto divide-y divide-slate-100">
            {searchResults.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-slate-400">No products found</p>
            ) : searchResults.map((p) => (
              <label key={p.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-50">
                <input type="checkbox" checked={queue.has(p.id)} onChange={() => toggleQueue(p)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate text-slate-800">
                    {p.name}{p.colorVariant ? <span className="text-slate-400"> — {p.colorVariant}</span> : null}
                  </div>
                  <div className="text-xs font-mono text-slate-400">{p.sku} · {p.barcode}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Queue panel */}
      <div className="md:w-72 md:flex-shrink-0">
        <div className="bg-white rounded-xl border border-slate-200 md:sticky md:top-4 flex flex-col">
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">
              {queue.size} product{queue.size !== 1 ? "s" : ""}
            </span>
            {totalLabels > 0 && (
              <span className="text-xs text-slate-400">{totalLabels} label{totalLabels !== 1 ? "s" : ""}</span>
            )}
          </div>

          {/* Per-product barcode selection */}
          <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-100">
            {selectedProducts.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-slate-400">No products selected</p>
            ) : selectedProducts.map((p) => {
              const ucWithBarcode = (p.unitConversions ?? []).filter((uc) => uc.barcode);
              return (
                <div key={p.id} className="px-3 py-2.5">
                  {/* Product row */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-slate-800 truncate">
                        {p.name}{p.colorVariant ? <span className="text-slate-400"> — {p.colorVariant}</span> : null}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400">{p.sku}</div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-[10px] text-slate-400 select-none">copies</span>
                      <input
                        type="number" inputMode="numeric" min={1} max={100} value={getCopies(p.id)}
                        onChange={(e) => setCopy(p.id, parseInt(e.target.value) || 1)}
                        className="w-12 text-center px-1 py-0.5 border border-slate-300 rounded text-xs"
                        title="Number of copies to print"
                      />
                      <button
                        onClick={() => removeFromQueue(p)}
                        className="text-slate-300 hover:text-red-500 text-base leading-none px-0.5"
                        title="Remove"
                      >×</button>
                    </div>
                  </div>

                  {/* Barcode checkboxes */}
                  <div className="space-y-1 pl-0.5">
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={isBarcodeSelected(p.id, "base")}
                        onChange={() => toggleBarcode(p.id, "base")}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-[11px] text-slate-600 group-hover:text-slate-800 truncate">
                        <span className="font-medium">{p.unit?.name ?? "Base"}</span>
                        <span className="text-slate-400 font-mono ml-1">{p.barcode}</span>
                      </span>
                    </label>
                    {ucWithBarcode.map((uc) => (
                      <label key={uc.id} className="flex items-center gap-2 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={isBarcodeSelected(p.id, uc.id)}
                          onChange={() => toggleBarcode(p.id, uc.id)}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-[11px] text-slate-600 group-hover:text-slate-800 truncate">
                          <span className="font-medium">{uc.name}</span>
                          <span className="text-slate-400 ml-1">×{uc.conversionFactor}</span>
                          <span className="text-slate-400 font-mono ml-1">{uc.barcode}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Print button */}
          <div className="p-3 border-t border-slate-100">
            <button
              onClick={printLabels}
              disabled={totalLabels === 0}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold py-2 rounded-lg transition-colors"
            >
              🖨 Print {totalLabels > 0 ? `${totalLabels} Label${totalLabels !== 1 ? "s" : ""}` : "Labels"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
