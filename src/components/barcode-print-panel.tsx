"use client";

import { useState } from "react";

type Product = { id: string; name: string; sku: string; barcode: string; colorVariant: string | null; isActive: boolean; categoryId: string; category: { name: string }; unit: { name: string } };
type Category = { id: string; name: string };

export function BarcodePrintPanel({
  products,
  categories,
  preselect,
}: {
  products: Product[];
  categories: Category[];
  preselect: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(preselect));
  const [copies, setCopies] = useState<Record<string, number>>({});
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState("");

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function getCopies(id: string) { return copies[id] ?? 1; }
  function setCopy(id: string, n: number) { setCopies((c) => ({ ...c, [id]: Math.max(1, n) })); }

  const filtered = products.filter((p) => {
    const matchQ = !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.sku.toLowerCase().includes(q.toLowerCase()) || p.barcode.toLowerCase().includes(q.toLowerCase());
    const matchCat = !categoryId || p.categoryId === categoryId;
    return matchQ && matchCat;
  });

  const selectedProducts = products.filter((p) => selected.has(p.id));

  function printLabels() {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const labels = selectedProducts.flatMap((p) =>
      Array.from({ length: getCopies(p.id) }, () => `
        <div class="label">
          <img src="/api/barcodes/${encodeURIComponent(p.barcode)}" alt="${p.barcode}" class="barcode-img" />
          <div class="barcode-num">${p.barcode}</div>
          <div class="product-name">${p.name}${p.colorVariant ? ` — ${p.colorVariant}` : ""}</div>
          <div class="unit">${p.unit.name} · ${p.sku}</div>
        </div>
      `)
    ).join("");

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Barcode Labels — MRIs</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; background: #fff; }
          .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 12px; }
          .label { border: 1px dashed #ccc; border-radius: 6px; padding: 10px 12px; display: flex; flex-direction: column; align-items: center; gap: 4px; }
          .barcode-img { width: 160px; height: auto; }
          .barcode-num { font-family: monospace; font-size: 10px; color: #555; letter-spacing: 1px; }
          .product-name { font-size: 11px; font-weight: 600; text-align: center; }
          .unit { font-size: 10px; color: #777; }
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
    <div className="flex gap-5">
      {/* Product list */}
      <div className="flex-1">
        <div className="flex gap-2 mb-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…"
            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All Categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2 text-xs text-slate-500">
            <button onClick={() => setSelected(new Set(filtered.map((p) => p.id)))} className="hover:text-blue-600">Select all</button>
            <span>·</span>
            <button onClick={() => setSelected(new Set())} className="hover:text-blue-600">Clear</button>
          </div>
          <div className="max-h-[480px] overflow-y-auto divide-y divide-slate-100">
            {filtered.map((p) => (
              <label key={p.id} className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer ${p.isActive ? "hover:bg-slate-50" : "hover:bg-slate-50 opacity-60"}`}>
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`text-sm font-medium truncate ${p.isActive ? "text-slate-800" : "text-slate-400"}`}>
                      {p.name}{p.colorVariant ? <span className="text-slate-400"> — {p.colorVariant}</span> : null}
                    </span>
                    {!p.isActive && (
                      <span className="flex-shrink-0 text-[9px] font-semibold bg-slate-200 text-slate-400 px-1.5 py-0.5 rounded-full uppercase tracking-wide">Inactive</span>
                    )}
                  </div>
                  <div className="text-xs font-mono text-slate-400">{p.barcode}</div>
                </div>
                {selected.has(p.id) && (
                  <input type="number" min={1} max={100} value={getCopies(p.id)}
                    onChange={(e) => setCopy(p.id, parseInt(e.target.value) || 1)}
                    onClick={(e) => e.preventDefault()}
                    className="w-14 text-center px-2 py-1 border border-slate-300 rounded text-xs"
                    title="Copies" />
                )}
              </label>
            ))}
            {filtered.length === 0 && <p className="px-4 py-8 text-center text-xs text-slate-400">No products</p>}
          </div>
        </div>
      </div>

      {/* Preview + print */}
      <div className="w-72 flex-shrink-0">
        <div className="bg-white rounded-xl border border-slate-200 p-4 sticky top-4">
          <div className="text-sm font-semibold text-slate-700 mb-3">
            {selected.size} product{selected.size !== 1 ? "s" : ""} selected
            {selected.size > 0 && <span className="text-slate-400 font-normal"> · {selectedProducts.reduce((s, p) => s + getCopies(p.id), 0)} labels</span>}
          </div>

          {selectedProducts.slice(0, 4).map((p) => (
            <div key={p.id} className="flex flex-col items-center border border-dashed border-slate-300 rounded-lg p-3 mb-2 gap-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/barcodes/${encodeURIComponent(p.barcode)}`} alt={p.barcode} className="w-40 h-auto" />
              <div className="font-mono text-[10px] text-slate-500">{p.barcode}</div>
              <div className="text-xs font-semibold text-center">{p.name}</div>
              <div className="text-[10px] text-slate-400">{p.unit.name} · {p.sku}</div>
            </div>
          ))}
          {selectedProducts.length > 4 && (
            <p className="text-xs text-slate-400 text-center mb-2">+{selectedProducts.length - 4} more…</p>
          )}

          <button onClick={printLabels} disabled={selected.size === 0}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold py-2 rounded-lg transition-colors mt-2">
            🖨 Print Labels
          </button>
        </div>
      </div>
    </div>
  );
}
