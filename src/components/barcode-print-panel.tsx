"use client";

import { useState, useMemo } from "react";

type UnitConversion = { id: string; name: string; conversionFactor: number; barcode: string | null };
type Product = { id: string; name: string; sku: string; barcode: string; colorVariant: string | null; isActive: boolean; categoryId: string; category: { name: string }; unit: { name: string }; unitConversions: UnitConversion[] };
type Category = { id: string; name: string };

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
  }

  function getCopies(id: string) { return copies[id] ?? 1; }
  function setCopy(id: string, n: number) { setCopies((c) => ({ ...c, [id]: Math.max(1, n) })); }

  const selectedProducts = [...queue.values()];

  function printLabels() {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const labels = selectedProducts.flatMap((p) => {
      const copies = getCopies(p.id);
      const baseLabel = `
        <div class="label">
          <img src="/api/barcodes/${encodeURIComponent(p.barcode)}" alt="${p.barcode}" class="barcode-img" />
          <div class="barcode-num">${p.barcode}</div>
          <div class="product-name">${p.name}${p.colorVariant ? ` — ${p.colorVariant}` : ""}</div>
          <div class="unit">${p.unit?.name ?? ""} · ${p.sku}</div>
        </div>
      `;
      const unitLabels = (p.unitConversions ?? [])
        .filter((uc) => uc.barcode)
        .map((uc) => `
          <div class="label">
            <img src="/api/barcodes/${encodeURIComponent(uc.barcode!)}" alt="${uc.barcode}" class="barcode-img" />
            <div class="barcode-num">${uc.barcode}</div>
            <div class="product-name">${p.name}${p.colorVariant ? ` — ${p.colorVariant}` : ""}</div>
            <div class="unit">${uc.name} (×${uc.conversionFactor}) · ${p.sku}</div>
          </div>
        `);
      return Array.from({ length: copies }, () => [baseLabel, ...unitLabels]).flat();
    }).join("");

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Barcode Labels — MRIs</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; background: #fff; }
          @page { size: A4 portrait; margin: 8mm; }
          .grid { display: grid; grid-template-columns: repeat(4, 40mm); gap: 3mm; }
          .label { width: 40mm; height: 30mm; border: 1px dashed #ccc; padding: 2.5mm 2.5mm; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1mm; overflow: hidden; }
          .barcode-img { width: 35mm; height: auto; flex-shrink: 0; }
          .barcode-num { font-family: monospace; font-size: 6.5pt; color: #555; letter-spacing: 0.5px; flex-shrink: 0; }
          .product-name { font-size: 7.5pt; font-weight: 600; text-align: center; width: 36mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .unit { font-size: 6.5pt; color: #777; width: 36mm; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          @media print { body { -webkit-print-color-adjust: exact; } }
        </style>
      </head>
      <body><div class="grid">${labels}</div></body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 500);
  }

  return (
    <div className="flex flex-col md:flex-row gap-5">
      {/* Product list */}
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
                  onClick={() => setQueue((prev) => {
                    const next = new Map(prev);
                    searchResults.forEach((p) => next.set(p.id, p));
                    return next;
                  })}
                  className="hover:text-blue-600 font-medium"
                >
                  Select all
                </button>
              </>
            )}
            <span>·</span>
            <button onClick={() => setQueue(new Map())} className="hover:text-red-600">Clear queue</button>
          </div>
          <div className="max-h-[480px] overflow-y-auto divide-y divide-slate-100">
            {searchResults.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-slate-400">No products found</p>
            ) : searchResults.map((p) => (
              <label key={p.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-50">
                <input type="checkbox" checked={queue.has(p.id)} onChange={() => toggleQueue(p)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-sm font-medium truncate text-slate-800">
                      {p.name}{p.colorVariant ? <span className="text-slate-400"> — {p.colorVariant}</span> : null}
                    </span>
                  </div>
                  <div className="text-xs font-mono text-slate-400">{p.sku} · {p.barcode}</div>
                </div>
                {queue.has(p.id) && (
                  <input type="number" inputMode="numeric" min={1} max={100} value={getCopies(p.id)}
                    onChange={(e) => setCopy(p.id, parseInt(e.target.value) || 1)}
                    onClick={(e) => e.preventDefault()}
                    className="w-14 text-center px-2 py-1 border border-slate-300 rounded text-xs"
                    title="Copies" />
                )}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Preview + print */}
      <div className="md:w-72 md:flex-shrink-0">
        <div className="bg-white rounded-xl border border-slate-200 p-4 md:sticky md:top-4">
          <div className="text-sm font-semibold text-slate-700 mb-3">
            {queue.size} product{queue.size !== 1 ? "s" : ""} selected
            {queue.size > 0 && <span className="text-slate-400 font-normal"> · {selectedProducts.reduce((s, p) => {
              const unitBarcodes = (p.unitConversions ?? []).filter((uc) => uc.barcode).length;
              return s + getCopies(p.id) * (1 + unitBarcodes);
            }, 0)} labels</span>}
          </div>

          {(() => {
            const previewLabels: React.ReactNode[] = [];
            for (const p of selectedProducts) {
              if (previewLabels.length >= 4) break;
              previewLabels.push(
                <div key={`${p.id}-base`} className="flex flex-col items-center border border-dashed border-slate-300 rounded-lg p-3 mb-2 gap-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/barcodes/${encodeURIComponent(p.barcode)}`} alt={p.barcode} className="w-40 h-auto" />
                  <div className="font-mono text-[10px] text-slate-500">{p.barcode}</div>
                  <div className="text-xs font-semibold text-center">{p.name}</div>
                  <div className="text-[10px] text-slate-400">{p.unit?.name ?? "—"} · {p.sku}</div>
                </div>
              );
              for (const uc of (p.unitConversions ?? [])) {
                if (previewLabels.length >= 4) break;
                if (!uc.barcode) continue;
                previewLabels.push(
                  <div key={`${p.id}-uc-${uc.id}`} className="flex flex-col items-center border border-dashed border-slate-300 rounded-lg p-3 mb-2 gap-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/barcodes/${encodeURIComponent(uc.barcode)}`} alt={uc.barcode} className="w-40 h-auto" />
                    <div className="font-mono text-[10px] text-slate-500">{uc.barcode}</div>
                    <div className="text-xs font-semibold text-center">{p.name}</div>
                    <div className="text-[10px] text-slate-400">{uc.name} (×{uc.conversionFactor}) · {p.sku}</div>
                  </div>
                );
              }
            }
            const totalLabels = selectedProducts.reduce((sum, p) => {
              const unitBarcodes = (p.unitConversions ?? []).filter((uc) => uc.barcode).length;
              return sum + 1 + unitBarcodes;
            }, 0);
            return (
              <>
                {previewLabels}
                {totalLabels > 4 && (
                  <p className="text-xs text-slate-400 text-center mb-2">+{totalLabels - 4} more…</p>
                )}
              </>
            );
          })()}

          <button onClick={printLabels} disabled={queue.size === 0}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold py-2 rounded-lg transition-colors mt-2">
            🖨 Print Labels
          </button>
        </div>
      </div>
    </div>
  );
}
