"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import toast from "react-hot-toast";
import { NumberField } from "@/components/number-field";
import { labelCounts } from "@/lib/label-counts";

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
  batchSize?: number; // pause every N physical labels (QZ only); 0/undefined = print all at once
};

type UnitConversion = { id: string; name: string; conversionFactor: number; barcode: string | null };
type Product = {
  id: string; name: string; sku: string; barcode: string;
  colorVariant: string | null; isActive: boolean; categoryId: string;
  category: { name: string }; unit: { name: string };
  unitConversions: UnitConversion[];
  stock: { locationId: string; quantity: number }[];
};
type Category = { id: string; name: string };
type LocationOption = { id: string; name: string };

// One physical label to print
type LabelItem = { barcode: string; name: string; unitLine: string };

// Printer resolution. Confirmed 300 DPI by physical measurement (2026-06-10):
// a 369-dot barcode printed at exactly 3.1cm = 300 DPI, 1:1 dots. If the
// printer is ever swapped for a 203 DPI model, labels will print ~1.5× too
// large/clipped — change this to 203.
const PRINTER_DPI = 300;
const PRINTER_DPMM = PRINTER_DPI / 25.4; // ≈ 11.81 dots/mm

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

// ── Batch checkpoint modal (shown between QZ batches) ─────────────────────────
function BatchCheckpointModal({
  printedSoFar, total, batchNo, batchCount, printing, onContinue, onReprint, onStop,
}: {
  printedSoFar: number; total: number; batchNo: number; batchCount: number;
  printing: boolean; onContinue: () => void; onReprint: () => void; onStop: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6">
        <h2 className="text-base font-semibold text-slate-800 mb-1">
          Batch {batchNo} dari {batchCount} selesai
        </h2>
        <p className="text-sm text-slate-600 mb-1">
          <b>{printedSoFar}</b> dari <b>{total}</b> label sudah dicetak.
        </p>
        <p className="text-xs text-slate-500 mb-4">
          Periksa hasil cetak & rapikan posisi gulungan label sebelum melanjutkan.
        </p>
        <div className="w-full bg-slate-100 rounded-full h-2 mb-5 overflow-hidden">
          <div className="bg-blue-600 h-2 rounded-full transition-all"
            style={{ width: `${Math.round((printedSoFar / total) * 100)}%` }} />
        </div>
        <div className="space-y-2">
          <button onClick={onContinue} disabled={printing}
            className="w-full px-4 py-2.5 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg font-semibold transition-colors">
            {printing ? "Mencetak…" : "Lanjut — cetak batch berikutnya"}
          </button>
          <div className="flex gap-2">
            <button onClick={onReprint} disabled={printing}
              className="flex-1 px-4 py-2.5 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 font-medium transition-colors">
              Cetak ulang batch ini
            </button>
            <button onClick={onStop} disabled={printing}
              className="flex-1 px-4 py-2.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 font-medium transition-colors">
              Berhenti
            </button>
          </div>
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
  locations,
  preselect,
  initialCounts = {},
  labelSettings: savedSettings = null,
}: {
  products: Product[];
  categories: Category[];
  locations: LocationOption[];
  preselect: string[];
  initialCounts?: Record<string, Record<string, number>>;
  labelSettings?: LabelSettings | null;
}) {
  const settings = savedSettings ?? DEFAULT_SETTINGS;

  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
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
  // Per-product, per-barcode label counts: counts[productId][barcodeKey] = n,
  // where barcodeKey is "base" or a unit-conversion id. Lets box and pcs differ.
  const [counts, setCounts] = useState<Record<string, Record<string, number>>>(initialCounts);

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

  // Default 1 per barcode for a manually-added product (matches old behavior);
  // GRN / stock auto-fill set explicit per-unit counts that override this.
  function getCount(pid: string, key: string): number { return counts[pid]?.[key] ?? 1; }
  function setCount(pid: string, key: string, n: number | null) {
    setCounts((c) => ({ ...c, [pid]: { ...(c[pid] ?? {}), [key]: Math.max(0, n ?? 0) } }));
  }

  function stockAt(p: Product): number {
    if (!warehouseId) return 0;
    return (p.stock ?? []).filter((s) => s.locationId === warehouseId).reduce((sum, s) => sum + s.quantity, 0);
  }

  // Auto-fill counts from current warehouse stock: each packaging unit gets its
  // full-box count (floor), the base unit gets one-per-box-plus-remainder (ceil).
  function unitCountsFromStock(p: Product): Record<string, number> {
    const stock = stockAt(p);
    const packs = (p.unitConversions ?? []).filter((uc) => uc.barcode && uc.conversionFactor > 1);
    const row: Record<string, number> = {};
    if (packs.length) {
      const minFactor = Math.min(...packs.map((uc) => uc.conversionFactor));
      row.base = labelCounts(stock, minFactor).pcsLabels;
      for (const uc of packs) row[uc.id] = Math.floor(stock / uc.conversionFactor);
    } else {
      row.base = stock;
    }
    return row;
  }

  function fillCountsFromStock(productIds?: string[], silent = false) {
    if (!warehouseId) { if (!silent) toast.error("Pick a warehouse first"); return; }
    const ids = productIds ?? [...queue.keys()];
    if (ids.length === 0) return;
    setCounts((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        const p = queue.get(id) ?? allProducts.find((x) => x.id === id);
        if (p) next[id] = unitCountsFromStock(p);
      }
      return next;
    });
    if (!silent) toast.success("Counts refilled from stock");
  }

  // Add every product in the current search/category view that has stock at the
  // chosen warehouse, and fill each product's label counts from that stock.
  function addAllInViewWithStock() {
    if (!warehouseId) { toast.error("Pick a warehouse first"); return; }
    const withStock = searchResults.filter((p) => stockAt(p) > 0);
    if (withStock.length === 0) { toast("No products have stock here for this filter", { icon: "ℹ️" }); return; }
    setQueue((prev) => { const next = new Map(prev); withStock.forEach((p) => next.set(p.id, p)); return next; });
    setSelectedBarcodes((prev) => {
      const next = new Map(prev);
      withStock.forEach((p) => { if (!next.has(p.id)) next.set(p.id, allBarcodeKeys(p)); });
      return next;
    });
    setCounts((prev) => {
      const next = { ...prev };
      withStock.forEach((p) => { next[p.id] = unitCountsFromStock(p); });
      return next;
    });
    toast.success(`Added ${withStock.length} product(s) with stock`);
  }

  // When the warehouse changes, silently re-sync counts for whatever's already
  // queued, so the numbers always match the chosen warehouse — no manual refill.
  useEffect(() => {
    if (warehouseId) fillCountsFromStock(undefined, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseId]);

  const selectedProducts = [...queue.values()];
  const totalLabels = selectedProducts.reduce((sum, p) => {
    const sel = selectedBarcodes.get(p.id) ?? new Set();
    let n = 0;
    if (sel.has("base")) n += getCount(p.id, "base");
    for (const uc of (p.unitConversions ?? [])) {
      if (uc.barcode && sel.has(uc.id)) n += getCount(p.id, uc.id);
    }
    return sum + n;
  }, 0);

  // Build the flat list of labels (one item per physical label). The QZ path
  // renders each item to a PNG on a canvas; the window.print fallback turns
  // them into HTML via labelItemHtml().
  const buildLabelsArray = useCallback((): LabelItem[] => {
    return selectedProducts.flatMap((p) => {
      const sel = selectedBarcodes.get(p.id) ?? new Set();
      const out: LabelItem[] = [];
      const name = `${p.name}${p.colorVariant ? ` — ${p.colorVariant}` : ""}`;

      const pushN = (n: number, barcode: string, unitLine: string) => {
        for (let i = 0; i < n; i++) out.push({ barcode, name, unitLine });
      };

      if (sel.has("base")) pushN(getCount(p.id, "base"), p.barcode, `${p.unit?.name ?? ""} · ${p.sku}`);
      for (const uc of (p.unitConversions ?? [])) {
        if (!uc.barcode || !sel.has(uc.id)) continue;
        pushN(getCount(p.id, uc.id), uc.barcode!, `${uc.name} (×${uc.conversionFactor}) · ${p.sku}`);
      }
      return out;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProducts, selectedBarcodes, counts]);

  // One label as HTML — used only by the window.print fallback (real browser
  // rendering, so modern CSS is fine there).
  function labelItemHtml(it: LabelItem): string {
    const s = settings;
    return `<div class="label"><div class="label-inner">` +
      `<img src="/api/barcodes/${encodeURIComponent(it.barcode)}" alt="${it.barcode}" class="barcode-img" />` +
      ((s.showBarcodeNum ?? true) ? `<div class="barcode-num">${it.barcode}</div>` : "") +
      ((s.showProductName ?? true) ? `<div class="product-name">${it.name}</div>` : "") +
      ((s.showUnit ?? true) ? `<div class="unit">${it.unitLine}</div>` : "") +
      `</div></div>`;
  }

  // ── Batch printing state (QZ only) ──
  // chunks: the full label list split into batches; index: last batch printed.
  const [batchState, setBatchState] = useState<{ chunks: LabelItem[][]; index: number } | null>(null);
  const [batchPrinting, setBatchPrinting] = useState(false);
  // Barcode PNGs (printer-resolution, whole-dot bars) for the current print run,
  // fetched once in startQZPrint and reused across batch continues/reprints.
  const barcodePngsRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // Build a QZ config from current label settings.
  //
  // Print pipeline (2026-06-10, v2 of the scannability fix): each label is sent
  // to QZ as a FINISHED PNG image, composed on a browser canvas at the printer's
  // resolution. No HTML rendering happens outside the browser (QZ's internal
  // HTML engine scrambled the layout — flexbox/calc unsupported), and the
  // barcode bitmap is placed 1:1 so every bar stays a whole number of printer
  // dots (scannable). density declares the bitmap's resolution; scaleContent
  // false + nearest-neighbor forbid any resampling that would distort bars.
  function makeQzConfig() {
    const qz = qzRef.current;
    const s = settings;
    const isPortrait = s.height >= s.width;
    // Size in inches so density can be declared in DPI, matching the printer's
    // native resolution exactly (300 DPI; mm-based density would be 11.81, a
    // float QZ handles less predictably).
    return qz.configs.create(s.printerName, {
      size: { width: s.width / 25.4, height: s.height / 25.4 },
      units: "in",
      margins: 0,
      orientation: isPortrait ? "portrait" : "landscape",
      scaleContent: false,
      density: PRINTER_DPI,
      interpolation: "nearest-neighbor",
    });
  }

  // Compose one label as a PNG at printer resolution, mirroring the HTML layout:
  // barcode → number → name → unit, centered as a block, 1mm gaps, X/Y offsets.
  // The barcode image is drawn at its NATIVE pixel width (1 px = 1 printer dot);
  // only its height is stretched, which never affects bar widths.
  //
  // On PORTRAIT stock (height > width, e.g. 40×60mm) the content is composed
  // along the LONG axis and rotated 90° onto the label. Packing-unit barcodes
  // (e.g. THR-00415-BOXOF, ~200 modules) physically cannot fit across a 40mm
  // label at a scannable bar width — they need the 60mm axis. This matches the
  // old known-good labels (5cm barcode on 4cm-wide stock). A 90° rotation maps
  // pixels 1:1, so bars stay whole printer dots.
  function renderLabelPng(item: LabelItem, barcodeImg: HTMLImageElement): string {
    const s = settings;
    const dp = PRINTER_DPMM;
    const physW = Math.round(s.width * dp);
    const physH = Math.round(s.height * dp);
    const rotate = s.height > s.width; // portrait stock → compose landscape, rotate
    const W = rotate ? physH : physW;  // logical composition width = long axis
    const H = rotate ? physW : physH;

    const canvas = document.createElement("canvas");
    canvas.width = physW;
    canvas.height = physH;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, physW, physH);
    ctx.save();
    if (rotate) {
      // Logical (0,0) → physical top-right; logical +x runs down the label
      ctx.translate(physW, 0);
      ctx.rotate(Math.PI / 2);
    }

    const wMm = W / dp; // logical width in mm (the long side when rotated)
    const hMm = H / dp;

    // Same defaults as buildPrintHtml so QZ output matches the browser preview
    const shortSide = Math.min(s.width, s.height);
    const namePt = s.namePt ?? Math.max(8, Math.min(11, Math.round(shortSide * 0.22)));
    const smallPt = s.smallPt ?? Math.max(7, Math.min(10, Math.round(shortSide * 0.18)));
    const ptToPx = (pt: number) => Math.round(pt * (25.4 / 72) * dp);
    const namePx = ptToPx(namePt);
    const smallPx = ptToPx(smallPt);
    const lineH = (px: number) => Math.round(px * 1.3);
    const gap = Math.round(1 * dp); // 1mm between elements
    const textW = Math.round((wMm - 4) * dp);
    // Barcode may use the full logical width minus a 3mm quiet zone per side
    // (scannability beats the widthPct styling knob, which still governs the
    // browser-print fallback).
    const maxBarW = Math.round((wMm - 6) * dp);
    const barH = Math.max(8, Math.round(hMm * ((s.barcodeHeightPct ?? 45) / 100) * dp));
    const showNum = s.showBarcodeNum ?? true;
    const showName = s.showProductName ?? true;
    const showUnit = s.showUnit ?? true;

    // Server guarantees the PNG fits maxBarW; the min() is just a safety net.
    const barW = Math.min(barcodeImg.naturalWidth, maxBarW);

    let total = barH;
    if (showNum) total += gap + lineH(smallPx);
    if (showName) total += gap + lineH(namePx);
    if (showUnit) total += gap + lineH(smallPx);

    // Offsets keep their PHYSICAL meaning (X = across the label, Y = down the
    // label) regardless of rotation.
    const offX = rotate ? (s.offsetY ?? 0) : (s.offsetX ?? 0);
    const offY = rotate ? -(s.offsetX ?? 0) : (s.offsetY ?? 0);

    let y = Math.round((H - total) / 2 + offY * dp);
    const cx = Math.round(W / 2 + offX * dp);

    ctx.drawImage(barcodeImg, cx - Math.round(barW / 2), y, barW, barH);
    y += barH;

    ctx.fillStyle = "#000";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const fit = (text: string, maxW: number) => {
      if (ctx.measureText(text).width <= maxW) return text;
      let t = text;
      while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
      return t + "…";
    };

    if (showNum) {
      y += gap;
      ctx.font = `${smallPx}px monospace`;
      ctx.fillText(item.barcode, cx, y);
      y += lineH(smallPx);
    }
    if (showName) {
      y += gap;
      ctx.font = `bold ${namePx}px Arial, sans-serif`;
      ctx.fillText(fit(item.name, textW), cx, y);
      y += lineH(namePx);
    }
    if (showUnit) {
      y += gap;
      ctx.font = `${smallPx}px Arial, sans-serif`;
      ctx.fillText(fit(item.unitLine, textW), cx, y);
    }

    ctx.restore();
    return canvas.toDataURL("image/png").split(",")[1]; // raw base64 for QZ
  }

  // Print one chunk (array of labels) as a single QZ job — one PNG per page.
  // Each job restarts at the printer's top-of-form, which is what resets drift.
  async function printChunk(items: LabelItem[]) {
    const qz = qzRef.current;
    if (!qz?.websocket.isActive()) throw new Error("QZ not connected");
    const pngs = barcodePngsRef.current;
    const data = items.map((it) => {
      const img = pngs.get(it.barcode);
      if (!img) throw new Error(`Barcode image missing: ${it.barcode}`);
      return { type: "pixel", format: "image", flavor: "base64", data: renderLabelPng(it, img) };
    });
    await qz.print(makeQzConfig(), data);
  }

  // Fetch every selected barcode as a printer-resolution PNG (whole-dot bars).
  async function fetchBarcodePngs(): Promise<Map<string, HTMLImageElement>> {
    const allBarcodes = new Set<string>();
    for (const p of selectedProducts) {
      const sel = selectedBarcodes.get(p.id) ?? new Set();
      if (sel.has("base")) allBarcodes.add(p.barcode);
      for (const uc of (p.unitConversions ?? [])) {
        if (uc.barcode && sel.has(uc.id)) allBarcodes.add(uc.barcode);
      }
    }
    const s = settings;
    // Barcode budget = the label's LONG axis minus 3mm quiet zone per side —
    // must match renderLabelPng's maxBarW (portrait stock prints rotated 90°).
    const maxw = Math.round((Math.max(s.width, s.height) - 6) * PRINTER_DPMM);
    const entries = await Promise.all(
      [...allBarcodes].map(async (bc) => {
        const res = await fetch(`/api/barcodes/${encodeURIComponent(bc)}?fmt=png&maxw=${maxw}`);
        if (!res.ok) throw new Error(`Barcode fetch failed: ${bc}`);
        const blob = await res.blob();
        const img = new Image();
        const url = URL.createObjectURL(blob);
        try {
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error(`Barcode image decode failed: ${bc}`));
            img.src = url;
          });
        } finally {
          // Image is decoded; the object URL is no longer needed
          setTimeout(() => URL.revokeObjectURL(url), 0);
        }
        return [bc, img] as const;
      })
    );
    return new Map(entries);
  }

  // QZ Tray direct print. When settings.batchSize > 0 and the run exceeds it,
  // print the first batch then pause for a checkpoint (continue / reprint / stop)
  // so the operator can re-seat the roll between batches — prevents label drift.
  async function startQZPrint() {
    if (batchState) return; // a batch run is already in progress
    const tid = toast.loading("Menyiapkan…");
    try {
      barcodePngsRef.current = await fetchBarcodePngs();
      const labels = buildLabelsArray();
      const bs = settings.batchSize && settings.batchSize > 0 ? Math.floor(settings.batchSize) : 0;

      // Batching off, or the whole run fits in one batch → single job (old behavior)
      if (bs === 0 || labels.length <= bs) {
        await printChunk(labels);
        toast.success(`${labels.length} label dicetak`, { id: tid });
        return;
      }

      // Split into batches, print the first, then open the checkpoint modal
      const chunks: LabelItem[][] = [];
      for (let i = 0; i < labels.length; i += bs) chunks.push(labels.slice(i, i + bs));
      await printChunk(chunks[0]);
      toast.success(`Batch 1/${chunks.length} dicetak`, { id: tid });
      setBatchState({ chunks, index: 0 });
    } catch (err) {
      toast.dismiss(tid);
      throw err; // handled by handlePrint → falls back to browser dialog
    }
  }

  // Checkpoint: print the next batch (and finish if it was the last one)
  async function continueBatch() {
    if (!batchState) return;
    const nextIndex = batchState.index + 1;
    setBatchPrinting(true);
    try {
      await printChunk(batchState.chunks[nextIndex]);
      if (nextIndex >= batchState.chunks.length - 1) {
        const total = batchState.chunks.reduce((n, c) => n + c.length, 0);
        toast.success(`Selesai — ${total} label dicetak`);
        setBatchState(null);
      } else {
        setBatchState({ ...batchState, index: nextIndex });
      }
    } catch {
      toast.error("Gagal mencetak batch — coba lagi");
    } finally {
      setBatchPrinting(false);
    }
  }

  // Checkpoint: reprint the batch that just came out (e.g. it jammed / drifted)
  async function reprintBatch() {
    if (!batchState) return;
    setBatchPrinting(true);
    try {
      await printChunk(batchState.chunks[batchState.index]);
      toast.success(`Batch ${batchState.index + 1} dicetak ulang`);
    } catch {
      toast.error("Gagal mencetak ulang batch");
    } finally {
      setBatchPrinting(false);
    }
  }

  // Checkpoint: stop the run, leaving remaining batches unprinted
  function stopBatch() {
    if (!batchState) return;
    const printed = batchState.chunks.slice(0, batchState.index + 1).reduce((n, c) => n + c.length, 0);
    const total = batchState.chunks.reduce((n, c) => n + c.length, 0);
    toast(`Dihentikan — ${printed} dari ${total} label dicetak`, { icon: "🛑" });
    setBatchState(null);
  }

  // Browser window.print() fallback — prints all at once (no batching; the
  // Chrome dialog already gives a natural pause per job).
  function printViaWindow() {
    const printWindow = window.open("", "_blank");
    if (!printWindow) { toast.error("Popup blocked — allow popups for this site"); return; }
    const html = buildPrintHtml(buildLabelsArray().map((it) => labelItemHtml(it)).join(""), settings);
    printWindow.document.write(html);
    printWindow.document.close();
  }

  // Main print handler
  async function handlePrint() {
    const canUseQZ = qzStatus === "connected" && !!settings.printerName;

    if (canUseQZ) {
      try {
        await startQZPrint();
      } catch {
        toast.error("QZ Tray error — beralih ke dialog browser");
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

        {/* Re-label from stock — pick a warehouse to auto-fill label counts from on-hand qty */}
        <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 overflow-hidden">
          <div className="px-3.5 py-2.5 flex flex-wrap items-center gap-2.5">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-blue-800">
              <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              Re-label from stock
            </span>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
              className="px-2.5 py-1.5 border border-blue-300 rounded-lg text-xs bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400">
              <option value="">Choose warehouse…</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            {warehouseId && (
              <button onClick={addAllInViewWithStock}
                className="sm:ml-auto inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
                </svg>
                Add all{categoryId ? " in category" : " in view"} with stock
              </button>
            )}
          </div>
          {warehouseId && (
            <div className="px-3.5 py-1.5 bg-blue-100/60 border-t border-blue-200 flex items-center justify-between gap-3 text-[10px] text-blue-700">
              <span>Counts auto-fill from stock — <b className="font-semibold">box</b> = full boxes, <b className="font-semibold">pcs</b> = one per box + leftover. Editable before printing.</span>
              <button onClick={() => fillCountsFromStock()} className="font-semibold underline whitespace-nowrap hover:text-blue-900">↺ Refill counts</button>
            </div>
          )}
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
              const stock = stockAt(p);
              return (
                <div key={p.id} className="px-3 py-2.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-slate-800 truncate">
                        {p.name}{p.colorVariant ? <span className="text-slate-400"> — {p.colorVariant}</span> : null}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400">
                        {p.sku}
                        {warehouseId && <span className="ml-1 text-blue-500">· stock here: {stock} {p.unit?.name ?? ""}</span>}
                      </div>
                    </div>
                    <button onClick={() => removeFromQueue(p)}
                      className="flex-shrink-0 text-slate-300 hover:text-red-500 text-base leading-none px-0.5">×</button>
                  </div>
                  {/* Each barcode line has its own label count (box ≠ pcs). */}
                  <div className="space-y-1 pl-0.5">
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={isBarcodeSelected(p.id, "base")} onChange={() => toggleBarcode(p.id, "base")}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                      <span className="flex-1 min-w-0 text-[11px] text-slate-600 truncate">
                        <span className="font-medium">{p.unit?.name ?? "Base"}</span>
                        <span className="text-slate-400 font-mono ml-1">{p.barcode}</span>
                      </span>
                      <NumberField min={0} value={getCount(p.id, "base")} placeholder="0"
                        onChange={(v) => setCount(p.id, "base", v)}
                        className="w-12 text-center px-1 py-0.5 border border-slate-300 rounded text-xs" />
                    </div>
                    {ucWithBarcode.map((uc) => (
                      <div key={uc.id} className="flex items-center gap-2">
                        <input type="checkbox" checked={isBarcodeSelected(p.id, uc.id)} onChange={() => toggleBarcode(p.id, uc.id)}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                        <span className="flex-1 min-w-0 text-[11px] text-slate-600 truncate">
                          <span className="font-medium">{uc.name}</span>
                          <span className="text-slate-400 ml-1">×{uc.conversionFactor}</span>
                          <span className="text-slate-400 font-mono ml-1">{uc.barcode}</span>
                        </span>
                        <NumberField min={0} value={getCount(p.id, uc.id)} placeholder="0"
                          onChange={(v) => setCount(p.id, uc.id, v)}
                          className="w-12 text-center px-1 py-0.5 border border-slate-300 rounded text-xs" />
                      </div>
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

      {batchState && (
        <BatchCheckpointModal
          printedSoFar={batchState.chunks.slice(0, batchState.index + 1).reduce((n, c) => n + c.length, 0)}
          total={batchState.chunks.reduce((n, c) => n + c.length, 0)}
          batchNo={batchState.index + 1}
          batchCount={batchState.chunks.length}
          printing={batchPrinting}
          onContinue={continueBatch}
          onReprint={reprintBatch}
          onStop={stopBatch}
        />
      )}
    </div>
  );
}
