"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import toast from "react-hot-toast";

type LabelSettings = {
  width: number;
  height: number;
  printerName?: string;
  namePt?: number;
  smallPt?: number;
  barcodeHeightPct?: number;
  showBarcodeNum?: boolean;
  showProductName?: boolean;
  showUnit?: boolean;
  offsetX?: number;
  offsetY?: number;
  barcodeWidthPct?: number;
};

type UnitConversion = { id: string; name: string; conversionFactor: number; barcode: string | null };
type Product = {
  id: string; name: string; sku: string; barcode: string;
  colorVariant: string | null; isActive: boolean; categoryId: string;
  category: { name: string }; unit: { name: string };
  unitConversions: UnitConversion[];
};
type Category = { id: string; name: string };

function allBarcodeKeys(p: Product): Set<string> {
  return new Set(["base", ...(p.unitConversions ?? []).filter((uc) => uc.barcode).map((uc) => uc.id)]);
}

const DEFAULT_SETTINGS: LabelSettings = { width: 60, height: 40 };

// ── QZ Tray status badge ──────────────────────────────────────────────────────
function QzBadge({ status }: { status: "idle" | "connecting" | "connected" | "unavailable" }) {
  if (status === "idle" || status === "connecting") {
    return <span className="text-[10px] text-slate-400">Menghubungkan ke QZ Tray…</span>;
  }
  if (status === "connected") {
    return (
      <span className="flex items-center gap-1 text-[10px] text-green-700 font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
        QZ Tray terhubung — cetak langsung aktif
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[10px] text-amber-600">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
      QZ Tray tidak aktif —{" "}
      <a
        href="https://qz.io/download/"
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-amber-800"
      >
        install
      </a>
      {" "}untuk bypass dialog Chrome
    </span>
  );
}

// ── Fallback confirmation modal (shown when QZ is unavailable) ────────────────
function PrintConfirmModal({
  totalLabels, settings, onConfirm, onCancel,
}: {
  totalLabels: number; settings: LabelSettings;
  onConfirm: () => void; onCancel: () => void;
}) {
  const isPortrait = settings.height >= settings.width;
  const rows = [
    { label: "Printer", value: settings.printerName ? `"${settings.printerName}"` : "label printer Anda", note: 'bukan "Save as PDF"' },
    { label: "Paper size", value: `${settings.width} × ${settings.height} mm`, note: null },
    { label: "Margin", value: "None / Tidak ada", note: null },
    { label: "Scale", value: "100%", note: null },
    { label: "Orientation", value: isPortrait ? "Portrait" : "Landscape", note: null },
  ];
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-800 mb-1">Siap cetak {totalLabels} label?</h2>
        <p className="text-xs text-slate-500 mb-4">
          Pastikan pengaturan dialog print sudah benar sebelum lanjut:
        </p>
        <div className="bg-slate-50 rounded-xl border border-slate-200 divide-y divide-slate-100 mb-4">
          {rows.map((row) => (
            <div key={row.label} className="flex items-start gap-3 px-4 py-2.5">
              <span className="text-xs text-slate-400 w-24 flex-shrink-0 pt-0.5">{row.label}</span>
              <div>
                <span className="text-sm font-semibold text-slate-800">{row.value}</span>
                {row.note && <span className="text-xs text-slate-400 ml-1.5">({row.note})</span>}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 mb-2">
          Tip: Install{" "}
          <a href="https://qz.io/download/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
            QZ Tray
          </a>{" "}
          untuk cetak langsung tanpa dialog ini.
        </p>
        <p className="text-[11px] text-slate-400 mb-5">
          Ukuran salah?{" "}
          <a href="/settings" className="text-blue-600 hover:underline">Settings → Barcode Printer</a>.
        </p>
        <div className="flex gap-2">
          <button onClick={onCancel}
            className="flex-1 px-4 py-2.5 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 font-medium transition-colors">
            Batal
          </button>
          <button onClick={onConfirm}
            className="flex-1 px-4 py-2.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition-colors">
            Buka Dialog Print
          </button>
        </div>
      </div>
    </div>
  );
}

// ── HTML generation ───────────────────────────────────────────────────────────
function buildPrintHtml(labelsHtml: string, s: LabelSettings, baseUrl?: string): string {
  const shortSide = Math.min(s.width, s.height);
  const imgW = Math.max(10, s.width * ((s.barcodeWidthPct ?? 90) / 100));
  const textW = Math.max(20, s.width - 4);
  const innerW = Math.max(20, s.width - 4);
  const imgMaxH = Math.round(s.height * ((s.barcodeHeightPct ?? 45) / 100));
  const namePt = s.namePt ?? Math.max(8, Math.min(11, Math.round(shortSide * 0.22)));
  const smallPt = s.smallPt ?? Math.max(7, Math.min(10, Math.round(shortSide * 0.18)));
  const offsetX = s.offsetX ?? 0;
  const offsetY = s.offsetY ?? 0;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  ${baseUrl ? `<base href="${baseUrl}/" />` : ""}
  <title>Barcode Labels — MRIs</title>
  <script>window.addEventListener('load',function(){window.focus();window.print();window.addEventListener('afterprint',function(){window.close();});});<\/script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: ${s.width}mm; margin: 0; padding: 0; font-family: Arial, sans-serif; background: #fff; }
    @page { size: ${s.width}mm ${s.height}mm; margin: 0; }
    .label { width: ${s.width}mm; height: ${s.height}mm; position: relative; overflow: hidden; box-sizing: border-box; page-break-inside: avoid; break-inside: avoid; }
    .label:not(:last-child) { page-break-after: always; break-after: page; }
    .label:last-child { page-break-after: avoid; break-after: avoid; }
    .label-inner { position: absolute; top: calc(50% + ${offsetY}mm); left: calc(50% + ${offsetX}mm); transform: translate(-50%,-50%); display: flex; flex-direction: column; align-items: center; gap: 1mm; width: ${innerW}mm; }
    .barcode-img { display: block; width: ${imgW}mm; max-height: ${imgMaxH}mm; height: auto; flex-shrink: 1; object-fit: contain; }
    .barcode-num { display: block; font-family: monospace; font-size: ${smallPt}pt; color: #333; letter-spacing: 0.5px; text-align: center; width: ${textW}mm; flex-shrink: 0; }
    .product-name { display: block; font-size: ${namePt}pt; font-weight: 700; text-align: center; width: ${textW}mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .unit { display: block; font-size: ${smallPt}pt; color: #555; width: ${textW}mm; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>
</head>
<body>${labelsHtml}</body>
</html>`;
}

// ── Main component ────────────────────────────────────────────────────────────
export function BarcodePrintPanel({
  products: allProducts,
  categories,
  preselect,
  initialCopies = {},
  labelSettings: savedSettings = null,
}: {
  products: Product[];
  categories: Category[];
  preselect: string[];
  initialCopies?: Record<string, number>;
  labelSettings?: LabelSettings | null;
}) {
  const settings = savedSettings ?? DEFAULT_SETTINGS;

  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [qzStatus, setQzStatus] = useState<"idle" | "connecting" | "connected" | "unavailable">("idle");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const qzRef = useRef<any>(null);

  // Try to connect to QZ Tray on mount
  useEffect(() => {
    let mounted = true;
    async function initQZ() {
      setQzStatus("connecting");
      try {
        // Dynamic import avoids SSR issues with WebSocket/window
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mod = await import("qz-tray") as any;
        const qz = mod.default ?? mod;
        qzRef.current = qz;

        // No signed certificate — user sees "Allow Always" dialog once on first use
        qz.security.setCertificatePromise((resolve: (c: string) => void) => resolve(""));
        qz.security.setSignatureAlgorithm("SHA512");
        qz.security.setSignaturePromise(() => (resolve: () => void) => resolve());

        if (!qz.websocket.isActive()) {
          await qz.websocket.connect({ retries: 2, delay: 1 });
        }
        if (mounted) setQzStatus("connected");
      } catch {
        if (mounted) setQzStatus("unavailable");
      }
    }
    initQZ();
    return () => { mounted = false; };
  }, []);

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
    setQueue((prev) => { const next = new Map(prev); next.has(p.id) ? next.delete(p.id) : next.set(p.id, p); return next; });
    setSelectedBarcodes((prev) => {
      const next = new Map(prev);
      next.has(p.id) ? next.delete(p.id) : next.set(p.id, allBarcodeKeys(p));
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

  // Build all label divs HTML (shared between QZ and window.print paths)
  // barcodeDataUris: pre-fetched map used by QZ path so HTML is self-contained
  const buildLabelsHtml = useCallback((barcodeDataUris?: Map<string, string>) => {
    const s = settings;
    const showBarcodeNum = s.showBarcodeNum ?? true;
    const showProductName = s.showProductName ?? true;
    const showUnit = s.showUnit ?? true;

    return selectedProducts.flatMap((p) => {
      const n = getCopies(p.id);
      const sel = selectedBarcodes.get(p.id) ?? new Set();
      const batch: string[] = [];

      const imgSrc = (barcode: string) =>
        barcodeDataUris?.get(barcode) ?? `/api/barcodes/${encodeURIComponent(barcode)}`;

      const makeLabelHtml = (barcode: string, unitLine: string) =>
        `<div class="label"><div class="label-inner">` +
        `<img src="${imgSrc(barcode)}" alt="${barcode}" class="barcode-img" />` +
        (showBarcodeNum ? `<div class="barcode-num">${barcode}</div>` : "") +
        (showProductName ? `<div class="product-name">${p.name}${p.colorVariant ? ` — ${p.colorVariant}` : ""}</div>` : "") +
        (showUnit ? `<div class="unit">${unitLine}</div>` : "") +
        `</div></div>`;

      if (sel.has("base")) batch.push(makeLabelHtml(p.barcode, `${p.unit?.name ?? ""} · ${p.sku}`));
      for (const uc of (p.unitConversions ?? [])) {
        if (!uc.barcode || !sel.has(uc.id)) continue;
        batch.push(makeLabelHtml(uc.barcode!, `${uc.name} (×${uc.conversionFactor}) · ${p.sku}`));
      }
      return Array.from({ length: n }, () => [...batch]).flat();
    }).join("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProducts, selectedBarcodes, copies, settings]);

  // QZ Tray direct print — bypasses Chrome dialog entirely
  async function printViaQZ() {
    const qz = qzRef.current;
    if (!qz?.websocket.isActive()) throw new Error("QZ not connected");

    // Collect unique barcodes from selected items
    const allBarcodes = new Set<string>();
    for (const p of selectedProducts) {
      const sel = selectedBarcodes.get(p.id) ?? new Set();
      if (sel.has("base")) allBarcodes.add(p.barcode);
      for (const uc of (p.unitConversions ?? [])) {
        if (uc.barcode && sel.has(uc.id)) allBarcodes.add(uc.barcode);
      }
    }

    // Fetch barcode images as data URIs so the HTML is self-contained
    const entries = await Promise.all(
      [...allBarcodes].map(async (bc) => {
        const res = await fetch(`/api/barcodes/${encodeURIComponent(bc)}`);
        if (!res.ok) return [bc, ""] as const;
        const blob = await res.blob();
        const dataUri = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => resolve("");
          reader.readAsDataURL(blob);
        });
        return [bc, dataUri] as const;
      })
    );
    const barcodeDataUris = new Map(entries);

    const s = settings;
    const isPortrait = s.height >= s.width;
    const labelsHtml = buildLabelsHtml(barcodeDataUris);
    const fullHtml = buildPrintHtml(labelsHtml, s);

    const config = qz.configs.create(s.printerName, {
      size: { width: s.width, height: s.height },
      units: "mm",
      margins: 0,
      orientation: isPortrait ? "portrait" : "landscape",
      scaleContent: false,
      rasterize: false,
    });

    await qz.print(config, [{ type: "html", format: "plain", data: fullHtml }]);
  }

  // Browser window.print() fallback
  function printViaWindow() {
    const printWindow = window.open("", "_blank");
    if (!printWindow) { toast.error("Popup blocked — allow popups for this site"); return; }
    const html = buildPrintHtml(buildLabelsHtml(), settings);
    printWindow.document.write(html);
    printWindow.document.close();
  }

  // Main print handler
  async function handlePrint() {
    const canUseQZ = qzStatus === "connected" && !!settings.printerName;

    if (canUseQZ) {
      const tid = toast.loading("Mencetak…");
      try {
        await printViaQZ();
        toast.success(`${totalLabels} label dicetak`, { id: tid });
      } catch (err) {
        toast.error("QZ Tray error — beralih ke dialog browser", { id: tid });
        setShowConfirm(true);
      }
    } else {
      setShowConfirm(true);
    }
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
                    setQueue((prev) => { const next = new Map(prev); searchResults.forEach((p) => next.set(p.id, p)); return next; });
                    setSelectedBarcodes((prev) => { const next = new Map(prev); searchResults.forEach((p) => { if (!next.has(p.id)) next.set(p.id, allBarcodeKeys(p)); }); return next; });
                  }}
                  className="hover:text-blue-600 font-medium"
                >Select all</button>
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
            {totalLabels > 0 && <span className="text-xs text-slate-400">{totalLabels} label{totalLabels !== 1 ? "s" : ""}</span>}
          </div>

          {/* Per-product barcode selection */}
          <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-100">
            {selectedProducts.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-slate-400">No products selected</p>
            ) : selectedProducts.map((p) => {
              const ucWithBarcode = (p.unitConversions ?? []).filter((uc) => uc.barcode);
              return (
                <div key={p.id} className="px-3 py-2.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-slate-800 truncate">
                        {p.name}{p.colorVariant ? <span className="text-slate-400"> — {p.colorVariant}</span> : null}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400">{p.sku}</div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-[10px] text-slate-400 select-none">copies</span>
                      <input type="number" inputMode="numeric" min={1} max={100} value={getCopies(p.id)}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setCopy(p.id, parseInt(e.target.value) || 1)}
                        className="w-12 text-center px-1 py-0.5 border border-slate-300 rounded text-xs" />
                      <button onClick={() => removeFromQueue(p)}
                        className="text-slate-300 hover:text-red-500 text-base leading-none px-0.5">×</button>
                    </div>
                  </div>
                  <div className="space-y-1 pl-0.5">
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input type="checkbox" checked={isBarcodeSelected(p.id, "base")} onChange={() => toggleBarcode(p.id, "base")}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                      <span className="text-[11px] text-slate-600 group-hover:text-slate-800 truncate">
                        <span className="font-medium">{p.unit?.name ?? "Base"}</span>
                        <span className="text-slate-400 font-mono ml-1">{p.barcode}</span>
                      </span>
                    </label>
                    {ucWithBarcode.map((uc) => (
                      <label key={uc.id} className="flex items-center gap-2 cursor-pointer group">
                        <input type="checkbox" checked={isBarcodeSelected(p.id, uc.id)} onChange={() => toggleBarcode(p.id, uc.id)}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
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

          {/* QZ status + print button */}
          <div className="p-3 border-t border-slate-100 space-y-2">
            <QzBadge status={qzStatus} />
            <button
              onClick={handlePrint}
              disabled={totalLabels === 0}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold py-2 rounded-lg transition-colors"
            >
              🖨 Print {totalLabels > 0 ? `${totalLabels} Label${totalLabels !== 1 ? "s" : ""}` : "Labels"}
            </button>
          </div>
        </div>
      </div>

      {showConfirm && (
        <PrintConfirmModal
          totalLabels={totalLabels}
          settings={settings}
          onConfirm={() => { setShowConfirm(false); printViaWindow(); }}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
