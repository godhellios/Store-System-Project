"use client";

import { Fragment, useRef, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

type Location = { id: string; name: string; type: string };
type UnitConversion = { id: string; name: string; conversionFactor: number };

type LineItem = {
  _key: string;
  productId: string;
  name: string;
  sku: string;
  barcode: string;
  baseUnitId: string;
  baseUnitName: string;
  quantity: number;
  inputUnitId: string;
  inputUnitName: string;
  conversionFactor: number;
  unitConversions: UnitConversion[];
  notes: string;
};

type SearchProduct = {
  id: string; name: string; sku: string; barcode: string;
  isActive: boolean;
  unit: { id: string; name: string };
  unitConversions: UnitConversion[];
  category: { name: string };
  colorVariant: string | null;
};

type TransactionType = "GRN" | "GOODS_OUT" | "TRANSFER";

const CONFIG: Record<TransactionType, { fromLabel?: string; toLabel?: string; movementSign: 1 | -1 | 0 }> = {
  GRN: { toLabel: "Receiving Location", movementSign: 1 },
  GOODS_OUT: { fromLabel: "Issue From", movementSign: -1 },
  TRANSFER: { fromLabel: "Transfer From", toLabel: "Transfer To", movementSign: 0 },
};

// ── Goods Out flow state ────────────────────────────────────────────────────
type FlowState =
  | { step: "idle" }
  | { step: "confirm" }
  | { step: "saving" }
  | { step: "whatsapp"; orderId: string; orderNumber: string; whatsappUrl: string }
  | { step: "print"; orderId: string; orderNumber: string }
  | { step: "done"; orderNumber: string }
  | { step: "error"; message: string; onRetry: (() => void) | null };

// Maps flow step to the 0-based progress index (Save=0, WhatsApp=1, Print=2)
function progressIndex(step: FlowState["step"]): number {
  if (step === "saving") return 0;
  if (step === "whatsapp") return 1;
  if (step === "print") return 2;
  if (step === "done") return 3;
  return -1;
}

function StepProgress({ step }: { step: FlowState["step"] }) {
  const current = progressIndex(step);
  if (current < 0) return null;
  const labels = ["Save", "WhatsApp", "Print"];
  return (
    <div className="flex items-center mb-6 px-1">
      {labels.map((label, i) => (
        <Fragment key={label}>
          {i > 0 && (
            <div className={`flex-1 h-0.5 mx-2 mb-3.5 ${i <= current ? "bg-green-400" : "bg-slate-200"}`} />
          )}
          <div className="flex flex-col items-center">
            <div className={[
              "w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold",
              i < current  ? "bg-green-500 text-white" :
              i === current ? "bg-blue-600 text-white" :
              "bg-slate-200 text-slate-400",
            ].join(" ")}>
              {i < current ? "✓" : i + 1}
            </div>
            <span className={[
              "text-[9px] font-semibold mt-0.5 uppercase tracking-wide",
              i < current  ? "text-green-600" :
              i === current ? "text-blue-600" :
              "text-slate-400",
            ].join(" ")}>{label}</span>
          </div>
        </Fragment>
      ))}
    </div>
  );
}

function buildWhatsAppUrl({
  orderNumber,
  customer,
  fromLocationName,
  lines,
  notes,
  whatsappNumber,
}: {
  orderNumber: string;
  customer: string;
  fromLocationName: string;
  lines: LineItem[];
  notes: string;
  whatsappNumber: string;
}): string {
  const date = new Date().toLocaleString("id-ID", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const totalBaseUnits = lines.reduce((s, l) => s + Math.round(l.quantity * l.conversionFactor), 0);

  const itemLines = lines.map((l, i) => {
    const baseQty = Math.round(l.quantity * l.conversionFactor);
    return l.conversionFactor !== 1
      ? `${i + 1}. ${l.name} — ${l.quantity} ${l.inputUnitName} (= ${baseQty} ${l.baseUnitName})`
      : `${i + 1}. ${l.name} — ${l.quantity} ${l.baseUnitName}`;
  });

  const parts = [
    `*SURAT JALAN / DELIVERY ORDER*`,
    `No. DO: *${orderNumber}*`,
    `Tanggal: ${date}`,
    ...(customer        ? [`Customer: *${customer}*`]           : []),
    ...(fromLocationName ? [`Dari: ${fromLocationName}`]         : []),
    ``,
    `*DAFTAR BARANG:*`,
    ...itemLines,
    ``,
    `Total: *${lines.length} item* | *${totalBaseUnits} unit*`,
    ...(notes ? [`Catatan: ${notes}`] : []),
    ``,
    `_MRIs – Mitra Ramah Inventory System_`,
  ];

  return `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(parts.join("\n"))}`;
}

export function TransactionForm({
  type,
  locations,
  whatsappNumber = "6281283118487",
}: {
  type: TransactionType;
  locations: Location[];
  whatsappNumber?: string;
}) {
  const router = useRouter();
  const scanRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const cfg = CONFIG[type];

  const [scanInput, setScanInput]       = useState("");
  const [lines, setLines]               = useState<LineItem[]>([]);
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId]     = useState("");
  const [customer, setCustomer]         = useState("");
  const [reference, setReference]       = useState("");
  const [notes, setNotes]               = useState("");
  const [submitting, setSubmitting]     = useState(false);
  const [scanning, setScanning]         = useState(false);

  const [searchQuery, setSearchQuery]     = useState("");
  const [searchResults, setSearchResults] = useState<SearchProduct[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown]   = useState(false);

  const [flowState, setFlowState] = useState<FlowState>({ step: "idle" });
  const [draftRestored, setDraftRestored] = useState(false);
  const draftChecked = useRef(false);
  const DRAFT_KEY = `mris_draft_${type}`;

  // Save draft on every form change (skips on first render until restore check completes)
  useEffect(() => {
    if (!draftChecked.current) return;
    const hasContent = lines.length > 0 || fromLocationId || toLocationId || customer || reference || notes;
    if (!hasContent) { localStorage.removeItem(DRAFT_KEY); return; }
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ lines, fromLocationId, toLocationId, customer, reference, notes })); } catch {}
  }, [lines, fromLocationId, toLocationId, customer, reference, notes, DRAFT_KEY]);

  // Restore draft on mount (defined after save effect so save effect runs first on mount)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const draft = JSON.parse(saved);
        if (draft.lines?.length || draft.fromLocationId || draft.toLocationId || draft.customer || draft.reference || draft.notes) {
          setLines(draft.lines ?? []);
          setFromLocationId(draft.fromLocationId ?? "");
          setToLocationId(draft.toLocationId ?? "");
          setCustomer(draft.customer ?? "");
          setReference(draft.reference ?? "");
          setNotes(draft.notes ?? "");
          setDraftRestored(true);
        }
      }
    } catch { localStorage.removeItem(DRAFT_KEY); }
    draftChecked.current = true;
  }, [DRAFT_KEY]);

  function clearDraft() {
    localStorage.removeItem(DRAFT_KEY);
    setLines([]); setFromLocationId(""); setToLocationId(""); setCustomer(""); setReference(""); setNotes("");
    setDraftRestored(false);
  }

  useEffect(() => {
    if (!('ontouchstart' in window)) scanRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        searchRef.current  && !searchRef.current.contains(e.target as Node)
      ) setShowDropdown(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setSearchResults([]); setShowDropdown(false); return; }
    setSearchLoading(true);
    const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}`);
    setSearchLoading(false);
    if (res.ok) { setSearchResults(await res.json()); setShowDropdown(true); }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => doSearch(searchQuery), 250);
    return () => clearTimeout(t);
  }, [searchQuery, doSearch]);

  function buildLineItem(product: SearchProduct): LineItem {
    return {
      _key: Math.random().toString(36).slice(2),
      productId: product.id,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode,
      baseUnitId: product.unit.id,
      baseUnitName: product.unit.name,
      quantity: 1,
      inputUnitId: product.unit.id,
      inputUnitName: product.unit.name,
      conversionFactor: 1,
      unitConversions: product.unitConversions ?? [],
      notes: "",
    };
  }

  function addProduct(product: SearchProduct) {
    if (!product.isActive && type === "GRN") {
      toast.error(`${product.name} is deactivated — cannot receive`);
      return;
    }
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) return prev.map((l) => l.productId === product.id ? { ...l, quantity: l.quantity + 1 } : l);
      return [...prev, buildLineItem(product)];
    });
    toast.success(`Added: ${product.name}`, { duration: 1500 });
    setSearchQuery("");
    setShowDropdown(false);
    searchRef.current?.focus();
  }

  async function handleScan(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter" || !scanInput.trim()) return;
    setScanning(true);
    const res = await fetch(`/api/products/lookup?q=${encodeURIComponent(scanInput.trim())}`);
    setScanning(false);
    if (!res.ok) {
      toast.error(`"${scanInput}" — product not found`);
      setScanInput("");
      scanRef.current?.focus();
      return;
    }
    const product = await res.json();
    setScanInput("");
    scanRef.current?.focus();
    if (!product.isActive && type === "GRN") {
      toast.error(`${product.name} is deactivated — cannot receive`);
      return;
    }
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) return prev.map((l) => l.productId === product.id ? { ...l, quantity: l.quantity + 1 } : l);
      return [...prev, buildLineItem(product)];
    });
    toast.success(`Added: ${product.name}`, { duration: 1500 });
  }

  function updateLine(key: string, field: keyof LineItem, value: string | number) {
    setLines((prev) => prev.map((l) => l._key === key ? { ...l, [field]: value } : l));
  }

  function changeInputUnit(key: string, newUnitId: string) {
    setLines((prev) => prev.map((l) => {
      if (l._key !== key) return l;
      if (newUnitId === l.baseUnitId) return { ...l, inputUnitId: l.baseUnitId, inputUnitName: l.baseUnitName, conversionFactor: 1 };
      const match = l.unitConversions.find((c) => c.id === newUnitId);
      if (!match) return l;
      return { ...l, inputUnitId: match.id, inputUnitName: match.name, conversionFactor: match.conversionFactor };
    }));
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l._key !== key));
  }

  function validate(): boolean {
    if (lines.length === 0)                          { toast.error("Add at least one item"); return false; }
    if (cfg.fromLabel && !fromLocationId)            { toast.error("Select source location"); return false; }
    if (cfg.toLabel   && !toLocationId)              { toast.error("Select destination location"); return false; }
    if (type === "TRANSFER" && fromLocationId === toLocationId) { toast.error("Source and destination must be different"); return false; }
    return true;
  }

  async function handleSubmit() {
    if (!validate()) return;
    if (type === "GOODS_OUT") {
      setFlowState({ step: "confirm" });
      return;
    }
    // GRN / TRANSFER: save directly
    setSubmitting(true);
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        fromLocationId: fromLocationId || undefined,
        toLocationId:   toLocationId   || undefined,
        reference:      reference      || undefined,
        notes:          notes          || undefined,
        lines: lines.map((l) => ({
          productId: l.productId,
          quantity:  Math.round(l.quantity * l.conversionFactor),
          inputQty:  l.conversionFactor !== 1 ? l.quantity        : undefined,
          inputUnit: l.conversionFactor !== 1 ? l.inputUnitName   : undefined,
          notes:     l.notes || undefined,
        })),
      }),
    });
    setSubmitting(false);
    let data: { error?: string; order?: { id: string; orderNumber: string }; warnings?: string[] } = {};
    try { data = await res.json(); } catch { toast.error("Server error — please try again"); return; }
    if (!res.ok) { toast.error(data.error ?? "Failed to save order"); return; }
    if (data.warnings?.length) data.warnings.forEach((w) => toast(w, { icon: "⚠️", duration: 6000 }));
    toast.success(`${data.order!.orderNumber} saved`);
    localStorage.removeItem(DRAFT_KEY);
    router.push("/orders");
    router.refresh();
  }

  // ── Goods Out step 1: save ──────────────────────────────────────────────
  async function executeGoodsOutSave() {
    setFlowState({ step: "saving" });
    let res: Response;
    try {
      res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          fromLocationId: fromLocationId || undefined,
          toLocationId:   toLocationId   || undefined,
          customer:       customer       || undefined,
          reference:      reference      || undefined,
          notes:          notes          || undefined,
          lines: lines.map((l) => ({
            productId: l.productId,
            quantity:  Math.round(l.quantity * l.conversionFactor),
            inputQty:  l.conversionFactor !== 1 ? l.quantity      : undefined,
            inputUnit: l.conversionFactor !== 1 ? l.inputUnitName : undefined,
            notes:     l.notes || undefined,
          })),
        }),
      });
    } catch {
      setFlowState({ step: "error", message: "Network error — check your connection and try again.", onRetry: executeGoodsOutSave });
      return;
    }
    let data: { error?: string; order?: { id: string; orderNumber: string }; warnings?: string[] } = {};
    try { data = await res.json(); } catch {
      setFlowState({ step: "error", message: "Server error — please try again.", onRetry: executeGoodsOutSave });
      return;
    }
    if (!res.ok) {
      setFlowState({ step: "error", message: data.error ?? "Order failed to save. Please try again.", onRetry: executeGoodsOutSave });
      return;
    }
    if (data.warnings?.length) data.warnings.forEach((w) => toast(w, { icon: "⚠️", duration: 6000 }));

    const { id: orderId, orderNumber } = data.order!;
    const fromLocationName = locations.find((l) => l.id === fromLocationId)?.name ?? "";
    const whatsappUrl = buildWhatsAppUrl({ orderNumber, customer, fromLocationName, lines, notes, whatsappNumber });
    localStorage.removeItem(DRAFT_KEY);
    setFlowState({ step: "whatsapp", orderId, orderNumber, whatsappUrl });
  }

  // ── Goods Out step 2: send WhatsApp ─────────────────────────────────────
  function handleWhatsApp(orderId: string, orderNumber: string, whatsappUrl: string) {
    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
    fetch(`/api/orders/${orderId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ whatsappSentAt: true }),
    }).catch(() => {});
    setFlowState({ step: "print", orderId, orderNumber });
  }

  // ── Goods Out step 3: print DO ───────────────────────────────────────────
  function handlePrint(orderId: string, orderNumber: string) {
    window.open(`/orders/${orderId}/print`, "_blank", "noopener,noreferrer");
    setFlowState({ step: "done", orderNumber });
  }

  const totalBaseUnits = lines.reduce((s, l) => s + Math.round(l.quantity * l.conversionFactor), 0);

  return (
    <div>
      <div className="bg-white rounded-xl border border-slate-200 mb-4">

        {/* ── Draft restored banner ── */}
        {draftRestored && (
          <div className="px-5 py-2.5 bg-amber-50 border-b border-amber-100 flex items-center justify-between gap-3 text-xs text-amber-700 rounded-t-xl">
            <span>Draft restored from your last session — please review the items.</span>
            <button onClick={clearDraft} className="flex-shrink-0 font-semibold underline hover:text-amber-900">Clear</button>
          </div>
        )}

        {/* ── Header fields ── */}
        <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap gap-4 items-end">
          {cfg.fromLabel && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{cfg.fromLabel} *</label>
              <select value={fromLocationId} onChange={(e) => setFromLocationId(e.target.value)}
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Select…</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          )}
          {cfg.toLabel && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{cfg.toLabel} *</label>
              <select value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Select…</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          )}
          {type === "GOODS_OUT" && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Customer Name</label>
              <input value={customer} onChange={(e) => setCustomer(e.target.value)}
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-44"
                placeholder="Optional" />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Reference / DO#</label>
            <input value={reference} onChange={(e) => setReference(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-40"
              placeholder="Optional" />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-slate-500 mb-1">Notes</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Optional" />
          </div>
        </div>

        {/* ── Scan bar ── */}
        <div className="px-5 py-3 bg-green-50 border-b border-green-100 flex flex-wrap gap-3">
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <span className="text-xl">⬛</span>
            <div className="flex-1 sm:flex-none">
              <label className="block text-[10px] font-medium text-green-700 mb-0.5 uppercase tracking-wide">Scan / SKU</label>
              <input
                ref={scanRef}
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                onKeyDown={handleScan}
                className="w-full sm:w-56 px-3 py-2 border-2 border-green-500 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-400 bg-white"
                placeholder="Scan barcode or type SKU…"
                disabled={scanning}
              />
            </div>
          </div>
          <div className="relative w-full sm:w-auto">
            <label className="block text-[10px] font-medium text-slate-500 mb-0.5 uppercase tracking-wide">Search by name</label>
            <input
              ref={searchRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => searchQuery && setShowDropdown(true)}
              className="w-full sm:w-64 px-3 py-2 border-2 border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              placeholder="Type product name…"
              autoComplete="off"
            />
            {searchLoading && (
              <span className="absolute right-3 top-[calc(50%+6px)] -translate-y-1/2 text-xs text-slate-400 animate-pulse">…</span>
            )}
            {showDropdown && searchResults.length > 0 && (
              <div ref={dropdownRef}
                className="absolute z-50 top-full mt-1 left-0 w-full sm:w-80 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
                {searchResults.map((p) => (
                  <button key={p.id} type="button"
                    onMouseDown={(e) => { e.preventDefault(); addProduct(p); }}
                    className={`w-full text-left px-4 py-2.5 hover:bg-blue-50 border-b border-slate-50 last:border-0 transition-colors ${!p.isActive ? "opacity-50" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-800 truncate">{p.name}</div>
                        <div className="text-xs text-slate-400 font-mono">{p.sku}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-xs text-slate-500">{p.category.name}</div>
                        {p.colorVariant && <div className="text-xs text-slate-400">{p.colorVariant}</div>}
                        {!p.isActive && <div className="text-[10px] text-red-400 font-medium">Inactive</div>}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {showDropdown && searchQuery && searchResults.length === 0 && !searchLoading && (
              <div className="absolute z-50 top-full mt-1 left-0 w-full sm:w-64 bg-white border border-slate-200 rounded-xl shadow-xl px-4 py-3 text-xs text-slate-400">
                No products found for &quot;{searchQuery}&quot;
              </div>
            )}
          </div>
          {scanning && <span className="text-xs text-slate-500 animate-pulse">Looking up…</span>}
        </div>

        {/* ── Line items — mobile cards ── */}
        <div className="md:hidden divide-y divide-slate-100">
          {lines.length === 0 ? (
            <p className="px-4 py-10 text-center text-slate-400 text-xs">
              Scan a barcode, type a SKU, or search by name above to add items
            </p>
          ) : lines.map((line, i) => {
            const hasPackaging = line.unitConversions.length > 0;
            const baseQty = Math.round(line.quantity * line.conversionFactor);
            return (
              <div key={line._key} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <span className="text-[10px] text-slate-400 mr-1">#{i + 1}</span>
                    <span className="font-semibold text-slate-800 text-sm">{line.name}</span>
                    <div className="text-xs font-mono text-slate-400 mt-0.5">{line.sku}</div>
                  </div>
                  <button onClick={() => removeLine(line._key)}
                    className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 text-lg transition-colors">
                    ×
                  </button>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input type="number" inputMode="numeric" min="1" value={line.quantity}
                    onChange={(e) => updateLine(line._key, "quantity", Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-20 text-center px-2 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  {hasPackaging ? (
                    <select value={line.inputUnitId} onChange={(e) => changeInputUnit(line._key, e.target.value)}
                      className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value={line.baseUnitId}>{line.baseUnitName}</option>
                      {line.unitConversions.map((c) => (
                        <option key={c.id} value={c.id}>{c.name} (×{c.conversionFactor})</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-sm text-slate-500 px-3 py-2 bg-slate-50 rounded-lg border border-slate-200">{line.baseUnitName}</span>
                  )}
                  {line.conversionFactor !== 1 && (
                    <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2.5 py-1.5 rounded-lg">
                      = {baseQty} {line.baseUnitName}
                    </span>
                  )}
                </div>
                <input value={line.notes} onChange={(e) => updateLine(line._key, "notes", e.target.value)}
                  className="mt-2 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                  placeholder="Notes (optional)" />
              </div>
            );
          })}
        </div>

        {/* ── Line items — desktop table ── */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="px-4 py-2.5 text-left font-medium">#</th>
                <th className="px-4 py-2.5 text-left font-medium">Product</th>
                <th className="px-4 py-2.5 text-center font-medium">Qty</th>
                <th className="px-4 py-2.5 text-left font-medium">Unit</th>
                <th className="px-4 py-2.5 text-right font-medium">= Base qty</th>
                <th className="px-4 py-2.5 text-left font-medium">Notes</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400 text-xs">
                  Scan a barcode, type a SKU, or search by product name above to add items
                </td></tr>
              ) : lines.map((line, i) => {
                const hasPackaging = line.unitConversions.length > 0;
                const baseQty = Math.round(line.quantity * line.conversionFactor);
                return (
                  <tr key={line._key} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2 text-slate-400 text-xs">{i + 1}</td>
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-800">{line.name}</div>
                      <div className="text-xs font-mono text-slate-400">{line.sku}</div>
                    </td>
                    <td className="px-4 py-2 text-center">
                      <input type="number" inputMode="numeric" min="1" value={line.quantity}
                        onChange={(e) => updateLine(line._key, "quantity", Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-20 text-center px-2 py-1 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </td>
                    <td className="px-4 py-2">
                      {hasPackaging ? (
                        <select value={line.inputUnitId} onChange={(e) => changeInputUnit(line._key, e.target.value)}
                          className="px-2 py-1 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500">
                          <option value={line.baseUnitId}>{line.baseUnitName}</option>
                          {line.unitConversions.map((c) => (
                            <option key={c.id} value={c.id}>{c.name} (×{c.conversionFactor})</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-slate-500">{line.baseUnitName}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {line.conversionFactor !== 1 ? (
                        <span className="text-sm font-semibold text-blue-700">{baseQty} {line.baseUnitName}</span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <input value={line.notes} onChange={(e) => updateLine(line._key, "notes", e.target.value)}
                        className="w-full px-2 py-1 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                        placeholder="Optional" />
                    </td>
                    <td className="px-4 py-2">
                      <button onClick={() => removeLine(line._key)}
                        className="text-red-400 hover:text-red-600 hover:bg-red-50 rounded px-1.5 py-0.5 transition-colors text-base leading-none">
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Footer ── */}
        <div className="px-5 py-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-slate-500">
            {lines.length} line{lines.length !== 1 ? "s" : ""} · {totalBaseUnits} base unit{totalBaseUnits !== 1 ? "s" : ""} total
          </span>
          <div className="flex gap-3">
            <button onClick={() => router.back()}
              className="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || lines.length === 0 || flowState.step !== "idle"}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors"
            >
              {submitting ? "Saving…" : "Save Order"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Goods Out flow modal ─────────────────────────────────────────────── */}
      {flowState.step !== "idle" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm mx-4 text-center">

            {/* ── confirm ── */}
            {flowState.step === "confirm" && (
              <>
                <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h2 className="text-lg font-bold text-slate-800 mb-1">Save this Goods Out order?</h2>
                <p className="text-sm text-slate-500 mb-0.5">
                  {lines.length} item{lines.length !== 1 ? "s" : ""} · {totalBaseUnits} base unit{totalBaseUnits !== 1 ? "s" : ""}
                </p>
                {fromLocationId && (
                  <p className="text-xs text-slate-400 mb-0.5">
                    From: {locations.find((l) => l.id === fromLocationId)?.name}
                  </p>
                )}
                {customer && (
                  <p className="text-xs text-slate-400 mb-0.5">Customer: {customer}</p>
                )}
                <p className="text-xs text-amber-600 font-medium mt-3 mb-5">
                  After saving: Send DO to WhatsApp → Print DO (mandatory)
                </p>
                <div className="flex gap-3">
                  <button onClick={() => setFlowState({ step: "idle" })}
                    className="flex-1 px-4 py-2.5 text-sm border border-slate-300 rounded-xl text-slate-600 hover:bg-slate-50 font-medium">
                    Cancel
                  </button>
                  <button onClick={executeGoodsOutSave}
                    className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition-colors">
                    Yes, Save &amp; Proceed
                  </button>
                </div>
              </>
            )}

            {/* ── saving ── */}
            {flowState.step === "saving" && (
              <>
                <StepProgress step="saving" />
                <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7 text-slate-500 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
                <h2 className="text-lg font-bold text-slate-800 mb-1">Saving order…</h2>
                <p className="text-sm text-slate-400">Please wait</p>
              </>
            )}

            {/* ── whatsapp ── */}
            {flowState.step === "whatsapp" && (() => {
              const { orderId, orderNumber, whatsappUrl } = flowState;
              return (
                <>
                  <StepProgress step="whatsapp" />
                  <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h2 className="text-lg font-bold text-slate-800 mb-1">Order Saved!</h2>
                  <p className="text-sm font-mono text-slate-500 mb-4">{orderNumber}</p>
                  <p className="text-sm text-slate-600 mb-5">
                    Send the Delivery Order to WhatsApp. The print preview will open automatically.
                  </p>
                  <button
                    onClick={() => handleWhatsApp(orderId, orderNumber, whatsappUrl)}
                    className="w-full py-3 bg-green-500 hover:bg-green-600 text-white text-sm font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                    Send to WhatsApp
                  </button>
                </>
              );
            })()}

            {/* ── print ── */}
            {flowState.step === "print" && (() => {
              const { orderId, orderNumber } = flowState;
              return (
                <>
                  <StepProgress step="print" />
                  <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h2 className="text-lg font-bold text-slate-800 mb-1">WhatsApp Sent!</h2>
                  <p className="text-sm font-mono text-slate-500 mb-4">{orderNumber}</p>
                  <p className="text-sm text-slate-600 mb-5">
                    Open the print preview to print or save the Delivery Order.
                  </p>
                  <button
                    onClick={() => handlePrint(orderId, orderNumber)}
                    className="w-full py-3 bg-slate-800 hover:bg-slate-900 text-white text-sm font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    Print DO
                  </button>
                </>
              );
            })()}

            {/* ── done ── */}
            {flowState.step === "done" && (
              <>
                <StepProgress step="done" />
                <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className="text-lg font-bold text-slate-800 mb-1">Transaction Complete!</h2>
                <p className="text-sm font-mono text-slate-500 mb-2">{flowState.orderNumber}</p>
                <p className="text-xs text-slate-400 mb-6">
                  Order saved, DO sent to WhatsApp, and print preview opened.
                </p>
                <button
                  onClick={() => { router.push("/orders"); router.refresh(); }}
                  className="w-full py-3 bg-slate-800 hover:bg-slate-900 text-white text-sm font-bold rounded-xl transition-colors"
                >
                  Go to Orders
                </button>
              </>
            )}

            {/* ── error ── */}
            {flowState.step === "error" && (
              <>
                <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <h2 className="text-lg font-bold text-slate-800 mb-2">Something went wrong</h2>
                <p className="text-sm text-red-600 mb-6">{flowState.message}</p>
                <div className="flex gap-3">
                  {flowState.onRetry ? (
                    <>
                      <button onClick={() => setFlowState({ step: "idle" })}
                        className="flex-1 px-4 py-2.5 text-sm border border-slate-300 rounded-xl text-slate-600 hover:bg-slate-50 font-medium">
                        Back to Form
                      </button>
                      <button onClick={flowState.onRetry}
                        className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition-colors">
                        Retry
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setFlowState({ step: "idle" })}
                      className="w-full px-4 py-2.5 text-sm border border-slate-300 rounded-xl text-slate-600 hover:bg-slate-50 font-medium">
                      Back to Form
                    </button>
                  )}
                </div>
              </>
            )}

          </div>
        </div>
      )}
      {/* ─────────────────────────────────────────────────────────────────────── */}
    </div>
  );
}
