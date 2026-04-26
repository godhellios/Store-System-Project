"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

type Location = { id: string; name: string; type: string };
type LineItem = {
  _key: string;
  productId: string;
  name: string;
  sku: string;
  barcode: string;
  unitName: string;
  quantity: number;
  notes: string;
};
type SearchProduct = {
  id: string; name: string; sku: string; barcode: string;
  isActive: boolean; unit: { name: string }; category: { name: string };
  colorVariant: string | null;
};

type TransactionType = "GRN" | "GOODS_OUT" | "TRANSFER";

const CONFIG: Record<TransactionType, { title: string; fromLabel?: string; toLabel?: string; movementSign: 1 | -1 | 0 }> = {
  GRN: { title: "Goods Received (GRN)", toLabel: "Receiving Location", movementSign: 1 },
  GOODS_OUT: { title: "Goods Out Order", fromLabel: "Issue From", movementSign: -1 },
  TRANSFER: { title: "Stock Transfer", fromLabel: "Transfer From", toLabel: "Transfer To", movementSign: 0 },
};

export function TransactionForm({
  type,
  locations,
}: {
  type: TransactionType;
  locations: Location[];
}) {
  const router = useRouter();
  const scanRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const cfg = CONFIG[type];

  const [scanInput, setScanInput] = useState("");
  const [lines, setLines] = useState<LineItem[]>([]);
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [scanning, setScanning] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchProduct[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setSearchResults([]); setShowDropdown(false); return; }
    setSearchLoading(true);
    const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}`);
    setSearchLoading(false);
    if (res.ok) {
      const data = await res.json();
      setSearchResults(data);
      setShowDropdown(true);
    }
  }, []);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => doSearch(searchQuery), 250);
    return () => clearTimeout(t);
  }, [searchQuery, doSearch]);

  function addProduct(product: SearchProduct) {
    if (!product.isActive && type === "GRN") {
      toast.error(`${product.name} is deactivated — cannot receive`);
      return;
    }
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) {
        return prev.map((l) => l.productId === product.id ? { ...l, quantity: l.quantity + 1 } : l);
      }
      return [...prev, {
        _key: Math.random().toString(36).slice(2),
        productId: product.id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        unitName: product.unit.name,
        quantity: 1,
        notes: "",
      }];
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
      if (existing) {
        return prev.map((l) => l.productId === product.id ? { ...l, quantity: l.quantity + 1 } : l);
      }
      return [...prev, {
        _key: Math.random().toString(36).slice(2),
        productId: product.id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        unitName: product.unit.name,
        quantity: 1,
        notes: "",
      }];
    });

    toast.success(`Added: ${product.name}`, { duration: 1500 });
  }

  function updateLine(key: string, field: keyof LineItem, value: string | number) {
    setLines((prev) => prev.map((l) => l._key === key ? { ...l, [field]: value } : l));
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l._key !== key));
  }

  async function handleSubmit() {
    if (lines.length === 0) { toast.error("Add at least one item"); return; }
    if (cfg.fromLabel && !fromLocationId) { toast.error("Select source location"); return; }
    if (cfg.toLabel && !toLocationId) { toast.error("Select destination location"); return; }
    if (type === "TRANSFER" && fromLocationId === toLocationId) { toast.error("Source and destination must be different"); return; }

    setSubmitting(true);

    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        fromLocationId: fromLocationId || undefined,
        toLocationId: toLocationId || undefined,
        reference: reference || undefined,
        notes: notes || undefined,
        lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, notes: l.notes || undefined })),
      }),
    });

    const data = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      toast.error(data.error ?? "Failed to save order");
      return;
    }

    if (data.warnings?.length) {
      data.warnings.forEach((w: string) => toast(w, { icon: "⚠️", duration: 6000 }));
    }

    toast.success(`${data.order.orderNumber} saved`);
    router.push("/orders");
    router.refresh();
  }

  return (
    <div>
      <div className="bg-white rounded-xl border border-slate-200 mb-4">
        {/* Header */}
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

        {/* Scan bar */}
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
                autoFocus
                className="w-full sm:w-56 px-3 py-2 border-2 border-green-500 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-400 bg-white"
                placeholder="Scan barcode or type SKU…"
                disabled={scanning}
              />
            </div>
          </div>
          {/* Name search */}
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
                  <button
                    key={p.id}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); addProduct(p); }}
                    className={`w-full text-left px-4 py-2.5 hover:bg-blue-50 border-b border-slate-50 last:border-0 transition-colors ${!p.isActive ? "opacity-50" : ""}`}
                  >
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
                No products found for "{searchQuery}"
              </div>
            )}
          </div>
          {scanning && <span className="text-xs text-slate-500 animate-pulse">Looking up…</span>}
        </div>

        {/* Line items */}
        <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <th className="px-4 py-2.5 text-left font-medium">#</th>
              <th className="px-4 py-2.5 text-left font-medium">Product</th>
              <th className="px-4 py-2.5 text-left font-medium">Barcode</th>
              <th className="px-4 py-2.5 text-left font-medium">Unit</th>
              <th className="px-4 py-2.5 text-center font-medium">Qty</th>
              <th className="px-4 py-2.5 text-left font-medium">Notes</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400 text-xs">
                Scan a barcode, type a SKU, or search by product name above to add items
              </td></tr>
            ) : lines.map((line, i) => (
              <tr key={line._key} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2 text-slate-400 text-xs">{i + 1}</td>
                <td className="px-4 py-2">
                  <div className="font-medium text-slate-800">{line.name}</div>
                  <div className="text-xs font-mono text-slate-400">{line.sku}</div>
                </td>
                <td className="px-4 py-2 font-mono text-xs text-slate-400">{line.barcode}</td>
                <td className="px-4 py-2 text-xs text-slate-500">{line.unitName}</td>
                <td className="px-4 py-2 text-center">
                  <input
                    type="number" min="1" value={line.quantity}
                    onChange={(e) => updateLine(line._key, "quantity", Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-20 text-center px-2 py-1 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
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
            ))}
          </tbody>
        </table>

        </div>
        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-slate-500">
            {lines.length} line{lines.length !== 1 ? "s" : ""} · {lines.reduce((s, l) => s + l.quantity, 0)} items total
          </span>
          <div className="flex gap-3">
            <button onClick={() => router.back()} className="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={submitting || lines.length === 0}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors">
              {submitting ? "Saving…" : "Save Order"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
