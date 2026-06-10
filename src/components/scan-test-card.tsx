"use client";

import { useState, useMemo } from "react";

type UnitConversion = { id: string; name: string; conversionFactor: number; barcode: string | null };
type Product = {
  id: string; name: string; sku: string; barcode: string;
  colorVariant: string | null;
  unit: { name: string };
  unitConversions: UnitConversion[];
};

// A minimal diagnostic: render a real barcode big on screen so you can point a
// handheld scanner at the monitor and check whether it reads — before wasting
// label stock printing. Reuses the existing /api/barcodes/<barcode> SVG.
export function ScanTestCard({ products }: { products: Product[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState<{ barcode: string; label: string } | null>(null);

  const term = q.trim().toLowerCase();

  const results = useMemo(() => {
    if (!term) return [];
    return products
      .filter((p) =>
        p.name.toLowerCase().includes(term) ||
        p.sku.toLowerCase().includes(term) ||
        p.barcode.toLowerCase().includes(term)
      )
      .slice(0, 8);
  }, [products, term]);

  // Allow testing a raw barcode number typed directly (no product match needed).
  const rawDigits = /^[0-9]{6,}$/.test(q.trim()) ? q.trim() : null;

  return (
    <div className="mb-5 rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* Header / toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h1v14H4zM8 5h1v14H8zM12 5h2v14h-2zM17 5h1v14h-1zM20 5h0.5v14H20z" />
          </svg>
          Tes Scan Barcode
          <span className="text-xs font-normal text-slate-400">— cek apakah scanner bisa membaca, tanpa cetak</span>
        </span>
        <svg className={`w-4 h-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-slate-100 pt-4 flex flex-col md:flex-row gap-4">
          {/* Left: search + pick a barcode */}
          <div className="md:w-72 md:flex-shrink-0">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari produk / SKU, atau ketik nomor barcode…"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-slate-100 divide-y divide-slate-100">
              {rawDigits && (
                <button
                  onClick={() => setActive({ barcode: rawDigits, label: `Nomor: ${rawDigits}` })}
                  className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm"
                >
                  <span className="font-medium text-blue-700">Tampilkan barcode</span>{" "}
                  <span className="font-mono text-slate-600">{rawDigits}</span>
                </button>
              )}
              {!term && !rawDigits && (
                <p className="px-3 py-6 text-center text-xs text-slate-400">Ketik untuk mencari produk</p>
              )}
              {term && results.length === 0 && !rawDigits && (
                <p className="px-3 py-6 text-center text-xs text-slate-400">Tidak ada produk cocok</p>
              )}
              {results.map((p) => {
                const codes = [
                  { barcode: p.barcode, label: `${p.unit?.name ?? "Base"}` },
                  ...p.unitConversions
                    .filter((uc) => uc.barcode)
                    .map((uc) => ({ barcode: uc.barcode!, label: `${uc.name} (×${uc.conversionFactor})` })),
                ];
                return (
                  <div key={p.id} className="px-3 py-2">
                    <div className="text-sm font-medium text-slate-800 truncate">
                      {p.name}{p.colorVariant ? <span className="text-slate-400"> — {p.colorVariant}</span> : null}
                    </div>
                    <div className="text-[10px] font-mono text-slate-400 mb-1.5">{p.sku}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {codes.map((c) => (
                        <button
                          key={c.barcode}
                          onClick={() => setActive({ barcode: c.barcode, label: `${p.name} · ${c.label}` })}
                          className={`px-2 py-0.5 rounded-md text-[11px] border transition-colors ${
                            active?.barcode === c.barcode
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
                          }`}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: big scannable barcode */}
          <div className="flex-1 flex flex-col items-center justify-center">
            {active ? (
              <>
                <p className="text-xs text-slate-500 mb-2 text-center">{active.label}</p>
                {/* White card with generous margin = the quiet zone scanners need */}
                <div className="bg-white border border-slate-200 rounded-lg px-10 py-8 flex flex-col items-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/barcodes/${encodeURIComponent(active.barcode)}`}
                    alt={active.barcode}
                    style={{ width: 460, maxWidth: "100%", height: "auto" }}
                  />
                  <div className="mt-3 font-mono text-sm tracking-wider text-slate-700">{active.barcode}</div>
                </div>
                <p className="text-[11px] text-slate-400 mt-3 text-center max-w-xs">
                  Arahkan scanner ke layar. Jika berbunyi / terbaca, barcode bisa di-scan.
                  Atur kecerahan layar lebih terang jika sulit terbaca.
                </p>
              </>
            ) : (
              <p className="text-xs text-slate-400 text-center py-12">
                Pilih produk & barcode di kiri untuk menampilkannya di sini.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
