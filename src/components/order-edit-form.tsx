"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

type UnitConversion = { id: string; name: string; conversionFactor: number };

type LineItem = {
  _key: string;
  productId: string;
  name: string;
  sku: string;
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

type OrderLine = {
  id: string;
  quantity: number;
  inputQty: number | null;
  inputUnit: string | null;
  notes: string | null;
  product: {
    id: string; name: string; sku: string; barcode: string;
    unit: { id: string; name: string };
    unitConversions: UnitConversion[];
  };
};

type OrderForEdit = {
  id: string;
  orderNumber: string;
  type: string;
  customer: string | null;
  reference: string | null;
  notes: string | null;
  fromLocation: { name: string } | null;
  toLocation: { name: string } | null;
  lines: OrderLine[];
};

function initLineItem(line: OrderLine): LineItem {
  const { product } = line;
  if (line.inputUnit && line.inputQty != null) {
    const conv = product.unitConversions.find((c) => c.name === line.inputUnit);
    if (conv) {
      return {
        _key: Math.random().toString(36).slice(2),
        productId: product.id,
        name: product.name,
        sku: product.sku,
        baseUnitId: product.unit.id,
        baseUnitName: product.unit.name,
        quantity: line.inputQty,
        inputUnitId: conv.id,
        inputUnitName: conv.name,
        conversionFactor: conv.conversionFactor,
        unitConversions: product.unitConversions,
        notes: line.notes ?? "",
      };
    }
    // No matching conversion — stored as a plain unit name
    return {
      _key: Math.random().toString(36).slice(2),
      productId: product.id,
      name: product.name,
      sku: product.sku,
      baseUnitId: product.unit.id,
      baseUnitName: product.unit.name,
      quantity: line.inputQty,
      inputUnitId: product.unit.id,
      inputUnitName: line.inputUnit,
      conversionFactor: 1,
      unitConversions: product.unitConversions,
      notes: line.notes ?? "",
    };
  }
  return {
    _key: Math.random().toString(36).slice(2),
    productId: product.id,
    name: product.name,
    sku: product.sku,
    baseUnitId: product.unit.id,
    baseUnitName: product.unit.name,
    quantity: line.quantity,
    inputUnitId: product.unit.id,
    inputUnitName: product.unit.name,
    conversionFactor: 1,
    unitConversions: product.unitConversions,
    notes: line.notes ?? "",
  };
}

export function OrderEditForm({ order }: { order: OrderForEdit }) {
  const router = useRouter();
  const scanRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [lines, setLines] = useState<LineItem[]>(() => order.lines.map(initLineItem));
  const [customer, setCustomer] = useState(order.customer ?? "");
  const [reference, setReference] = useState(order.reference ?? "");
  const [notes, setNotes] = useState(order.notes ?? "");
  const [allUnits, setAllUnits] = useState<{ id: string; name: string; conversionFactor: number | null; parentUnitId: string | null }[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [scanInput, setScanInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchProduct[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    fetch("/api/units").then((r) => r.json()).then(setAllUnits).catch(() => {});
  }, []);

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

  function changeSystemUnit(key: string, unitName: string) {
    const unit = allUnits.find((u) => u.name === unitName);
    setLines((prev) => prev.map((l) => {
      if (l._key !== key) return l;
      if (!unit) return l;
      // If it's the product's own base unit, factor = 1
      if (unit.name === l.baseUnitName) {
        return { ...l, inputUnitName: l.baseUnitName, conversionFactor: 1 };
      }
      // Use the conversion factor defined in unit settings (relative to its parent)
      const factor = unit.conversionFactor ?? 1;
      return { ...l, inputUnitName: unit.name, conversionFactor: factor };
    }));
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l._key !== key));
  }

  async function handleConfirmSave() {
    setSaving(true);
    const res = await fetch(`/api/orders/${order.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer: customer || null,
        reference: reference || null,
        notes: notes || null,
        lines: lines.map((l) => ({
          productId: l.productId,
          quantity: Math.round(l.quantity * l.conversionFactor),
          inputQty: l.conversionFactor !== 1
            ? l.quantity
            : (l.inputUnitName !== l.baseUnitName ? l.quantity : undefined),
          inputUnit: l.conversionFactor !== 1
            ? l.inputUnitName
            : (l.inputUnitName !== l.baseUnitName ? l.inputUnitName : undefined),
          notes: l.notes || undefined,
        })),
      }),
    });
    setSaving(false);
    setConfirmOpen(false);
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error ?? "Failed to update order");
      return;
    }
    toast.success("Order updated");
    router.push(`/orders/${order.id}`);
    router.refresh();
  }

  const totalBaseUnits = lines.reduce((s, l) => s + Math.round(l.quantity * l.conversionFactor), 0);

  return (
    <div>
      {/* Metadata */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4 grid grid-cols-2 gap-4">
        {order.type === "GOODS_OUT" && (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Customer Name</label>
            <input value={customer} onChange={(e) => setCustomer(e.target.value)}
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Optional" />
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Reference / DO#</label>
          <input value={reference} onChange={(e) => setReference(e.target.value)}
            className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Optional" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-500 mb-1">Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Optional" />
        </div>
      </div>

      {/* Line items */}
      <div className="bg-white rounded-xl border border-slate-200">
        {/* Scan / search bar */}
        <div className="px-5 py-3 bg-green-50 border-b border-green-100 flex flex-wrap gap-3 rounded-t-xl">
          <div className="flex items-center gap-3">
            <span className="text-xl">⬛</span>
            <div>
              <label className="block text-[10px] font-medium text-green-700 mb-0.5 uppercase tracking-wide">Scan / SKU</label>
              <input
                ref={scanRef}
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                onKeyDown={handleScan}
                className="w-48 px-3 py-2 border-2 border-green-500 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-400 bg-white"
                placeholder="Scan barcode or SKU…"
                disabled={scanning}
              />
            </div>
          </div>
          <div className="relative">
            <label className="block text-[10px] font-medium text-slate-500 mb-0.5 uppercase tracking-wide">Search by name</label>
            <input
              ref={searchRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => searchQuery && setShowDropdown(true)}
              className="w-56 px-3 py-2 border-2 border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              placeholder="Type product name…"
              autoComplete="off"
            />
            {searchLoading && <span className="absolute right-3 top-[calc(50%+6px)] -translate-y-1/2 text-xs text-slate-400 animate-pulse">…</span>}
            {showDropdown && searchResults.length > 0 && (
              <div ref={dropdownRef} className="absolute z-50 top-full mt-1 left-0 w-80 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
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
                        {!p.isActive && <div className="text-[10px] text-red-400 font-medium">Inactive</div>}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {showDropdown && searchQuery && searchResults.length === 0 && !searchLoading && (
              <div className="absolute z-50 top-full mt-1 left-0 w-56 bg-white border border-slate-200 rounded-xl shadow-xl px-4 py-3 text-xs text-slate-400">
                No products found for &quot;{searchQuery}&quot;
              </div>
            )}
          </div>
          {scanning && <span className="text-xs text-slate-500 self-end pb-2 animate-pulse">Looking up…</span>}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
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
                  No items — scan or search above to add products
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
                      <input type="number" min="1" value={line.quantity}
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
                        <select
                          value={line.inputUnitName}
                          onChange={(e) => changeSystemUnit(line._key, e.target.value)}
                          className="px-2 py-1 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500">
                          {allUnits.length === 0
                            ? <option value={line.inputUnitName}>{line.inputUnitName}</option>
                            : allUnits.map((u) => (
                                <option key={u.id} value={u.name}>
                                  {u.name}{u.conversionFactor ? ` (×${u.conversionFactor})` : ""}
                                </option>
                              ))
                          }
                        </select>
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

        {/* Footer */}
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
              onClick={() => { if (lines.length === 0) { toast.error("Add at least one item"); return; } setConfirmOpen(true); }}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors">
              Save Changes
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation modal */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100">
              <h2 className="text-base font-bold text-slate-800">Confirm changes to {order.orderNumber}</h2>
              <p className="text-xs text-slate-500 mt-1">
                All existing stock movements will be <span className="font-semibold text-amber-600">reversed</span> and reapplied with the updated quantities.
              </p>
            </div>

            <div className="px-6 py-4 max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 uppercase tracking-wide border-b border-slate-100">
                    <th className="pb-1.5 text-left font-medium">Product</th>
                    <th className="pb-1.5 text-right font-medium">Qty</th>
                    <th className="pb-1.5 text-right font-medium">Base qty</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const base = Math.round(l.quantity * l.conversionFactor);
                    return (
                      <tr key={l._key} className="border-t border-slate-50">
                        <td className="py-1.5 text-slate-700 font-medium">{l.name}</td>
                        <td className="py-1.5 text-right text-slate-600">
                          {l.conversionFactor !== 1 ? `${l.quantity} ${l.inputUnitName}` : `${l.quantity} ${l.baseUnitName}`}
                        </td>
                        <td className="py-1.5 text-right text-slate-500">
                          {l.conversionFactor !== 1 ? `${base} ${l.baseUnitName}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex gap-3 justify-end">
              <button onClick={() => setConfirmOpen(false)} disabled={saving}
                className="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleConfirmSave} disabled={saving}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50">
                {saving ? "Saving…" : "Confirm & Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
