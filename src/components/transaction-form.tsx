"use client";

import { Fragment, useRef, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import toast from "react-hot-toast";
import { useT } from "@/modules/i18n/provider";

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
  stockByLocation: Array<{ locationId: string; quantity: number }>;
};

type SearchProduct = {
  id: string; name: string; sku: string; barcode: string;
  isActive: boolean;
  unit: { id: string; name: string };
  unitConversions: UnitConversion[];
  category: { name: string };
  colorVariant: string | null;
  stock: Array<{ locationId: string; quantity: number }>;
};

type MatchedUnit = { id: string; name: string; conversionFactor: number } | null;

type TransactionType = "GRN" | "GOODS_OUT" | "TRANSFER";


// ── Goods Out flow state ────────────────────────────────────────────────────
type FlowState =
  | { step: "idle" }
  | { step: "confirm" }
  | { step: "saving" }
  | { step: "grn_done"; orderId: string; orderNumber: string; isPending: boolean; barcodeUrl: string }
  | { step: "pending_approval"; orderId: string; orderNumber: string }
  | { step: "print"; orderId: string; orderNumber: string }
  | { step: "done"; orderNumber: string }
  | { step: "error"; message: string; onRetry: (() => void) | null };

// Maps flow step to the 0-based progress index (Save=0, Print=1)
function progressIndex(step: FlowState["step"]): number {
  if (step === "saving") return 0;
  if (step === "print") return 1;
  if (step === "done") return 2;
  return -1; // pending_approval, confirm, idle, error — no progress bar
}

function StepProgress({ step }: { step: FlowState["step"] }) {
  const t = useT();
  const current = progressIndex(step);
  if (current < 0) return null;
  const labels = [
    t("transactionForm.steps.save", "Save"),
    t("transactionForm.steps.print", "Print"),
  ];
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

export function TransactionForm({
  type,
  locations,
}: {
  type: TransactionType;
  locations: Location[];
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const t = useT();
  const scanRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  const CONFIG: Record<TransactionType, { fromLabel?: string; toLabel?: string; movementSign: 1 | -1 | 0 }> = {
    GRN: { toLabel: t("transactionForm.locationLabels.receivingLocation", "Receiving Location"), movementSign: 1 },
    GOODS_OUT: { fromLabel: t("transactionForm.locationLabels.issueFrom", "Issue From"), movementSign: -1 },
    TRANSFER: { fromLabel: t("transactionForm.locationLabels.transferFrom", "Transfer From"), toLabel: t("transactionForm.locationLabels.transferTo", "Transfer To"), movementSign: 0 },
  };
  const cfg = CONFIG[type];

  const [scanInput, setScanInput]       = useState("");
  const [lines, setLines]               = useState<LineItem[]>([]);
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId]     = useState("");
  const [customer, setCustomer]         = useState("");
  const [supplier, setSupplier]         = useState("");
  const [supplierId, setSupplierId]     = useState("");
  const [suppliers, setSuppliers]       = useState<{ id: string; name: string }[]>([]);
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
    const hasContent = lines.length > 0 || fromLocationId || toLocationId || customer || supplier || reference || notes;
    if (!hasContent) { localStorage.removeItem(DRAFT_KEY); return; }
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ lines, fromLocationId, toLocationId, customer, supplier, reference, notes })); } catch {}
  }, [lines, fromLocationId, toLocationId, customer, supplier, reference, notes, DRAFT_KEY]);

  // Restore draft on mount (defined after save effect so save effect runs first on mount)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const draft = JSON.parse(saved);
        if (draft.lines?.length || draft.fromLocationId || draft.toLocationId || draft.customer || draft.supplier || draft.reference || draft.notes) {
          setLines((draft.lines ?? []).map((l: LineItem) => ({ ...l, stockByLocation: l.stockByLocation ?? [] })));
          setFromLocationId(draft.fromLocationId ?? "");
          setToLocationId(draft.toLocationId ?? "");
          setCustomer(draft.customer ?? "");
          setSupplier(draft.supplier ?? "");
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
    setLines([]); setFromLocationId(""); setToLocationId(""); setCustomer(""); setSupplier(""); setReference(""); setNotes("");
    setDraftRestored(false);
  }

  useEffect(() => {
    if (!('ontouchstart' in window)) scanRef.current?.focus();
  }, []);

  useEffect(() => {
    if (type === "GRN") {
      fetch("/api/suppliers").then((r) => r.json()).then((data) => {
        if (Array.isArray(data)) setSuppliers(data);
      }).catch(() => {});
    }
  }, [type]);

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
    searchAbortRef.current?.abort();
    const ctrl = new AbortController();
    searchAbortRef.current = ctrl;
    setSearchLoading(true);
    try {
      const res = await fetch(`/api/products/search?full=1&q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal });
      if (res.ok) { setSearchResults(await res.json()); setShowDropdown(true); }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => doSearch(searchQuery), 250);
    return () => clearTimeout(t);
  }, [searchQuery, doSearch]);

  function buildLineItem(product: SearchProduct, matchedUnit?: MatchedUnit): LineItem {
    const inputUnitId      = matchedUnit?.id             ?? product.unit.id;
    const inputUnitName    = matchedUnit?.name           ?? product.unit.name;
    const conversionFactor = matchedUnit?.conversionFactor ?? 1;
    return {
      _key: Math.random().toString(36).slice(2),
      productId:       product.id,
      name:            product.name,
      sku:             product.sku,
      barcode:         product.barcode,
      baseUnitId:      product.unit.id,
      baseUnitName:    product.unit.name,
      quantity:        1,
      inputUnitId,
      inputUnitName,
      conversionFactor,
      unitConversions: product.unitConversions ?? [],
      notes:           "",
      stockByLocation: product.stock?.map(s => ({ locationId: s.locationId, quantity: s.quantity })) ?? [],
    };
  }

  function addProduct(product: SearchProduct) {
    if (!product.isActive && type === "GRN") {
      toast.error(`${product.name} is deactivated — cannot receive`);
      return;
    }
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === product.id && l.inputUnitId === product.unit.id);
      if (existing) return prev.map((l) => l.productId === product.id && l.inputUnitId === product.unit.id ? { ...l, quantity: l.quantity + 1 } : l);
      return [...prev, buildLineItem(product, null)];
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
    const { product, matchedUnit }: { product: SearchProduct; matchedUnit: MatchedUnit } = await res.json();
    setScanInput("");
    scanRef.current?.focus();
    if (!product.isActive && type === "GRN") {
      toast.error(`${product.name} is deactivated — cannot receive`);
      return;
    }
    const incomingUnitId = matchedUnit?.id ?? product.unit.id;
    setLines((prev) => {
      const existing = prev.find(
        (l) => l.productId === product.id && l.inputUnitId === incomingUnitId
      );
      if (existing) {
        return prev.map((l) =>
          l._key === existing._key ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      return [...prev, buildLineItem(product, matchedUnit)];
    });
    if (matchedUnit) {
      toast.success(`Added: ${product.name} — entering in ${matchedUnit.name} (1 ${matchedUnit.name} = ${matchedUnit.conversionFactor} ${product.unit.name})`, { duration: 2500 });
    } else {
      toast.success(`Added: ${product.name}`, { duration: 1500 });
    }
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
        supplier:       type === "GRN" ? (suppliers.find((s) => s.id === supplierId)?.name || supplier || undefined) : undefined,
        supplierId:     type === "GRN" ? (supplierId || undefined) : undefined,
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
    let data: { error?: string; order?: { id: string; orderNumber: string; grnStatus?: string | null; transferStatus?: string | null }; warnings?: string[] } = {};
    try { data = await res.json(); } catch { toast.error("Server error — please try again"); return; }
    if (!res.ok) { toast.error(data.error ?? "Failed to save order"); return; }
    if (data.warnings?.length) data.warnings.forEach((w) => toast(w, { icon: "⚠️", duration: 6000 }));
    const isPending = data.order?.grnStatus === "PENDING" || data.order?.transferStatus === "PENDING";
    localStorage.removeItem(DRAFT_KEY);

    if (type === "GRN") {
      const params = new URLSearchParams();
      lines.forEach((l) => params.append("productId", l.productId));
      params.set("copies", lines.map((l) => `${l.productId}:${Math.round(l.quantity * l.conversionFactor)}`).join(","));
      setFlowState({
        step: "grn_done",
        orderId: data.order!.id,
        orderNumber: data.order!.orderNumber,
        isPending,
        barcodeUrl: `/barcodes?${params.toString()}`,
      });
      return;
    }

    // TRANSFER
    if (isPending) {
      toast.success(`${data.order!.orderNumber} submitted — awaiting admin approval`, { duration: 5000 });
    } else {
      toast.success(`${data.order!.orderNumber} saved`);
    }
    router.push(isPending ? `/orders/${data.order!.id}` : "/orders");
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
          supplier:       supplier       || undefined,
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
    let data: { error?: string; order?: { id: string; orderNumber: string; goodsOutStatus?: string | null }; warnings?: string[] } = {};
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
    localStorage.removeItem(DRAFT_KEY);

    // When approval is required, skip Print — go to pending state instead
    if (data.order?.goodsOutStatus === "PENDING") {
      setFlowState({ step: "pending_approval", orderId, orderNumber });
      return;
    }

    // WhatsApp is optional and available from the order detail page (Resend WhatsApp).
    setFlowState({ step: "print", orderId, orderNumber });
  }

  // ── Goods Out step 2: print DO ───────────────────────────────────────────
  function handlePrint(orderId: string, orderNumber: string) {
    window.open(`/orders/${orderId}/print`, "_blank", "noopener,noreferrer");
    setFlowState({ step: "done", orderNumber });
  }

  function availableStock(line: LineItem): number | null {
    if (!fromLocationId) return null;
    const s = line.stockByLocation.find((s) => s.locationId === fromLocationId);
    return s?.quantity ?? 0;
  }

  const totalBaseUnits = lines.reduce((s, l) => s + Math.round(l.quantity * l.conversionFactor), 0);

  return (
    <div>
      <div className="bg-white rounded-xl border border-slate-200 mb-4">

        {/* ── Draft restored banner ── */}
        {draftRestored && (
          <div className="px-5 py-2.5 bg-amber-50 border-b border-amber-100 flex items-center justify-between gap-3 text-xs text-amber-700 rounded-t-xl">
            <span>{t("transactionForm.draftRestored", "Draft restored from your last session — please review the items.")}</span>
            <button onClick={clearDraft} className="flex-shrink-0 font-semibold underline hover:text-amber-900">{t("transactionForm.clearDraft", "Clear")}</button>
          </div>
        )}

        {/* ── Header fields ── */}
        <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap gap-4 items-end">
          {cfg.fromLabel && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{cfg.fromLabel} *</label>
              <select value={fromLocationId} onChange={(e) => setFromLocationId(e.target.value)}
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">{t("transactionForm.selectLocation", "Select…")}</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          )}
          {cfg.toLabel && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{cfg.toLabel} *</label>
              <select value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">{t("transactionForm.selectLocation", "Select…")}</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          )}
          {type === "GOODS_OUT" && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{t("transactionForm.customerName", "Customer Name")}</label>
              <input value={customer} onChange={(e) => setCustomer(e.target.value)}
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-44"
                placeholder={t("transactionForm.optional", "Optional")} />
            </div>
          )}
          {type === "GRN" && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{t("transactionForm.supplierName", "Supplier")}</label>
              {suppliers.length > 0 ? (
                <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-44">
                  <option value="">{t("transactionForm.optional", "— Optional —")}</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              ) : (
                <input value={supplier} onChange={(e) => setSupplier(e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-44"
                  placeholder={t("transactionForm.optional", "Optional")} />
              )}
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t("transactionForm.referenceNo", "Reference / DO#")}</label>
            <input value={reference} onChange={(e) => setReference(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-40"
              placeholder={t("transactionForm.optional", "Optional")} />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-slate-500 mb-1">{t("transactionForm.notes", "Notes")}</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t("transactionForm.optional", "Optional")} />
          </div>
        </div>

        {/* ── Scan bar ── */}
        <div className="px-5 py-3 bg-green-50 border-b border-green-100 flex flex-wrap gap-3">
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <span className="text-xl">⬛</span>
            <div className="flex-1 sm:flex-none">
              <label className="block text-[10px] font-medium text-green-700 mb-0.5 uppercase tracking-wide">{t("transactionForm.scanLabel", "Scan / SKU")}</label>
              <input
                ref={scanRef}
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                onKeyDown={handleScan}
                className="w-full sm:w-56 px-3 py-2 border-2 border-green-500 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-400 bg-white"
                placeholder={t("transactionForm.scanPlaceholder", "Scan barcode or type SKU…")}
                disabled={scanning}
              />
            </div>
          </div>
          <div className="relative w-full sm:w-auto">
            <label className="block text-[10px] font-medium text-slate-500 mb-0.5 uppercase tracking-wide">{t("transactionForm.searchByName", "Search by name")}</label>
            <input
              ref={searchRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => searchQuery && setShowDropdown(true)}
              className="w-full sm:w-64 px-3 py-2 border-2 border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              placeholder={t("transactionForm.searchPlaceholder", "Type product name…")}
              autoComplete="off"
            />
            {(showDropdown || (searchLoading && searchQuery.trim())) && (
              <div ref={dropdownRef}
                className="absolute z-50 top-full mt-1 left-0 w-full sm:w-80 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
                {searchLoading && (
                  <div className="px-4 py-3 flex items-center gap-2 text-xs text-slate-400">
                    <svg className="w-3.5 h-3.5 animate-spin text-blue-400" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    {t("transactionForm.searching", "Searching…")}
                  </div>
                )}
                {!searchLoading && searchResults.length > 0 && searchResults.map((p) => (
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
                {!searchLoading && searchResults.length === 0 && searchQuery.trim() && (
                  <div className="px-4 py-3 text-xs text-slate-400">
                    {t("transactionForm.noProductsFound", "No products found for")} &quot;{searchQuery.trim()}&quot;
                  </div>
                )}
              </div>
            )}
          </div>
          {scanning && <span className="text-xs text-slate-500 animate-pulse">{t("transactionForm.lookingUp", "Looking up…")}</span>}
        </div>

        {/* ── Line items — mobile cards ── */}
        <div className="md:hidden divide-y divide-slate-100">
          {lines.length === 0 ? (
            <p className="px-4 py-10 text-center text-slate-400 text-xs">
              {t("transactionForm.emptyPrompt", "Scan a barcode, type a SKU, or search by name above to add items")}
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
                  {(() => {
                    const avail = availableStock(line);
                    if (avail === null) return null;
                    const needed = baseQty;
                    const ok = avail >= needed;
                    return (
                      <span className={`text-[10px] font-medium px-2 py-1 rounded ${ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                        {ok ? `✓ ${avail}` : `✗ ${avail}`}
                      </span>
                    );
                  })()}
                </div>
                <input value={line.notes} onChange={(e) => updateLine(line._key, "notes", e.target.value)}
                  className="mt-2 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                  placeholder={t("transactionForm.notesOptional", "Notes (optional)")} />
              </div>
            );
          })}
        </div>

        {/* ── Line items — desktop table ── */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="px-4 py-2.5 text-left font-medium">{t("transactionForm.cols.no", "#")}</th>
                <th className="px-4 py-2.5 text-left font-medium">{t("transactionForm.cols.product", "Product")}</th>
                <th className="px-4 py-2.5 text-center font-medium">{t("transactionForm.cols.qty", "Qty")}</th>
                <th className="px-4 py-2.5 text-left font-medium">{t("transactionForm.cols.unit", "Unit")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t("transactionForm.cols.baseQty", "= Base qty")}</th>
                <th className="px-4 py-2.5 text-left font-medium">{t("transactionForm.cols.notes", "Notes")}</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400 text-xs">
                  {t("transactionForm.emptyPrompt", "Scan a barcode, type a SKU, or search by name above to add items")}
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
                      {(() => {
                        const avail = availableStock(line);
                        if (avail === null) return null;
                        const needed = baseQty;
                        const ok = avail >= needed;
                        return (
                          <div className={`text-[10px] font-medium mt-0.5 ${ok ? "text-green-600" : "text-red-500"}`}>
                            {ok ? `✓ ${avail} ${t("transactionForm.avail", "avail")}` : `✗ ${t("transactionForm.onlyAvail", "only")} ${avail} ${t("transactionForm.avail", "avail")}`}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-2">
                      <input value={line.notes} onChange={(e) => updateLine(line._key, "notes", e.target.value)}
                        className="w-full px-2 py-1 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                        placeholder={t("transactionForm.optional", "Optional")} />
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
            {lines.length} {lines.length !== 1 ? t("transactionForm.footer.lines", "lines") : t("transactionForm.footer.line", "line")} · {totalBaseUnits} {totalBaseUnits !== 1 ? t("transactionForm.footer.baseUnits", "base units") : t("transactionForm.footer.baseUnit", "base unit")} {t("transactionForm.footer.total", "total")}
          </span>
          <div className="flex gap-3">
            <button onClick={() => router.back()}
              className="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
              {t("common.cancel", "Cancel")}
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || lines.length === 0 || flowState.step !== "idle"}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors"
            >
              {submitting ? t("common.saving", "Saving…") : t("transactionForm.saveOrder", "Save Order")}
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
                <h2 className="text-lg font-bold text-slate-800 mb-1">{t("transactionForm.flow.confirmTitle", "Save this Goods Out order?")}</h2>
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
                  {t("transactionForm.flow.afterSaving", "After saving: order will be sent for admin approval. WhatsApp and print available from the order detail page.")}
                </p>
                <div className="flex gap-3">
                  <button onClick={() => setFlowState({ step: "idle" })}
                    className="flex-1 px-4 py-2.5 text-sm border border-slate-300 rounded-xl text-slate-600 hover:bg-slate-50 font-medium">
                    {t("common.cancel", "Cancel")}
                  </button>
                  <button onClick={executeGoodsOutSave}
                    className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition-colors">
                    {t("transactionForm.flow.saveAndProceed", "Yes, Save & Proceed")}
                  </button>
                </div>
              </>
            )}

            {/* ── grn done ── */}
            {flowState.step === "grn_done" && (() => {
              const { orderId, orderNumber, isPending, barcodeUrl } = flowState;
              return (
                <>
                  <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h2 className="text-lg font-bold text-slate-800 mb-1">Barang Masuk Tersimpan!</h2>
                  <p className="text-sm font-mono text-slate-500 mb-3">{orderNumber}</p>
                  {isPending && (
                    <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
                      Menunggu persetujuan Admin. Stok belum berubah.
                    </p>
                  )}
                  <button
                    onClick={() => { router.push(isPending ? `/orders/${orderId}` : "/orders"); router.refresh(); }}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition-colors"
                  >
                    Selesai
                  </button>
                </>
              );
            })()}

            {/* ── pending approval ── */}
            {flowState.step === "pending_approval" && (() => {
              const { orderId, orderNumber } = flowState;
              return (
                <>
                  <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-7 h-7 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h2 className="text-lg font-bold text-slate-800 mb-1">Submitted for Approval</h2>
                  <p className="text-sm font-mono text-slate-500 mb-3">{orderNumber}</p>
                  <p className="text-sm text-slate-600 mb-2">
                    Your Goods Out order has been saved and is <span className="font-semibold text-amber-600">awaiting admin approval</span>.
                  </p>
                  <p className="text-xs text-slate-400 mb-6">
                    Stock will only be deducted after the admin approves. WhatsApp and print are available from the order detail page.
                  </p>
                  <button
                    onClick={() => { router.push(`/orders/${orderId}`); router.refresh(); }}
                    className="w-full py-3 bg-slate-800 hover:bg-slate-900 text-white text-sm font-bold rounded-xl transition-colors"
                  >
                    View Order →
                  </button>
                </>
              );
            })()}

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
                <h2 className="text-lg font-bold text-slate-800 mb-1">{t("transactionForm.flow.savingTitle", "Saving order…")}</h2>
                <p className="text-sm text-slate-400">{t("transactionForm.flow.pleaseWait", "Please wait")}</p>
              </>
            )}

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
                  <h2 className="text-lg font-bold text-slate-800 mb-1">{t("transactionForm.flow.savedTitle", "Order Saved!")}</h2>
                  <p className="text-sm font-mono text-slate-500 mb-4">{orderNumber}</p>
                  <p className="text-sm text-slate-600 mb-5">
                    {t("transactionForm.flow.printDesc", "Open the print preview to print or save the Delivery Order.")}
                  </p>
                  <button
                    onClick={() => handlePrint(orderId, orderNumber)}
                    className="w-full py-3 bg-slate-800 hover:bg-slate-900 text-white text-sm font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    {t("transactionForm.flow.printDO", "Print DO")}
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
                <h2 className="text-lg font-bold text-slate-800 mb-1">{t("transactionForm.flow.doneTitle", "Transaction Complete!")}</h2>
                <p className="text-sm font-mono text-slate-500 mb-2">{flowState.orderNumber}</p>
                <p className="text-xs text-slate-400 mb-6">
                  {t("transactionForm.flow.doneSub", "Order saved and print preview opened.")}
                </p>
                <button
                  onClick={() => { router.push("/orders"); router.refresh(); }}
                  className="w-full py-3 bg-slate-800 hover:bg-slate-900 text-white text-sm font-bold rounded-xl transition-colors"
                >
                  {t("transactionForm.flow.goToOrders", "Go to Orders")}
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
                <h2 className="text-lg font-bold text-slate-800 mb-2">{t("transactionForm.flow.errorTitle", "Something went wrong")}</h2>
                <p className="text-sm text-red-600 mb-6">{flowState.message}</p>
                <div className="flex gap-3">
                  {flowState.onRetry ? (
                    <>
                      <button onClick={() => setFlowState({ step: "idle" })}
                        className="flex-1 px-4 py-2.5 text-sm border border-slate-300 rounded-xl text-slate-600 hover:bg-slate-50 font-medium">
                        {t("transactionForm.flow.backToForm", "Back to Form")}
                      </button>
                      <button onClick={flowState.onRetry}
                        className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition-colors">
                        {t("transactionForm.flow.retry", "Retry")}
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setFlowState({ step: "idle" })}
                      className="w-full px-4 py-2.5 text-sm border border-slate-300 rounded-xl text-slate-600 hover:bg-slate-50 font-medium">
                      {t("transactionForm.flow.backToForm", "Back to Form")}
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
