"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";

type Category = { id: string; name: string };
type Unit = { id: string; name: string };
type UnitConversion = { id?: string; name: string; conversionFactor: number; barcode: string | null };
type Product = {
  id: string; name: string; sku: string; barcode: string;
  categoryId: string; unitId: string; reorderPoint: number;
  colorVariant: string | null; description: string | null;
  imageUrl: string | null;
  unitConversions?: UnitConversion[];
};
type SavedProduct = {
  id: string; name: string; sku: string; barcode: string;
  colorVariant: string | null;
  category: { name: string };
  unit: { name: string };
};

function generateBarcode(): string {
  return "MR" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
}

const EMPTY_FORM = {
  name: "", sku: "", barcode: "", categoryId: "", unitId: "",
  reorderPoint: "0", colorVariant: "", description: "", imageUrl: "",
};

export function ProductForm({
  categories, units, product,
}: {
  categories: Category[];
  units: Unit[];
  product?: Product;
}) {
  const router = useRouter();
  const isEdit = !!product;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    name: product?.name ?? "",
    sku: product?.sku ?? "",
    barcode: product?.barcode ?? "",
    categoryId: product?.categoryId ?? "",
    unitId: product?.unitId ?? "",
    reorderPoint: product?.reorderPoint?.toString() ?? "0",
    colorVariant: product?.colorVariant ?? "",
    description: product?.description ?? "",
    imageUrl: product?.imageUrl ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savedProduct, setSavedProduct] = useState<SavedProduct | null>(null);

  const [conversions, setConversions] = useState<UnitConversion[]>(
    product?.unitConversions?.map((c) => ({ ...c, barcode: c.barcode ?? "" })) ?? []
  );
  const [newConvName, setNewConvName] = useState("");
  const [newConvFactor, setNewConvFactor] = useState("");
  const [newConvBarcode, setNewConvBarcode] = useState("");
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editFactor, setEditFactor] = useState("");
  const [editBarcode, setEditBarcode] = useState("");

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const baseUnitName = units.find((u) => u.id === form.unitId)?.name ?? "base unit";

  function addConversion() {
    const name = newConvName.trim();
    const factor = parseFloat(newConvFactor);
    if (!name || !factor || factor <= 0) return;
    if (conversions.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      toast.error(`"${name}" already defined`);
      return;
    }
    const barcode = newConvBarcode.trim() || generateBarcode();
    setConversions((prev) => [...prev, { name, conversionFactor: factor, barcode }]);
    setNewConvName("");
    setNewConvFactor("");
    setNewConvBarcode("");
  }

  function removeConversion(index: number) {
    setConversions((prev) => prev.filter((_, i) => i !== index));
    if (editingIdx === index) setEditingIdx(null);
  }

  function startEdit(index: number) {
    setEditingIdx(index);
    setEditName(conversions[index].name);
    setEditFactor(conversions[index].conversionFactor.toString());
    setEditBarcode(conversions[index].barcode ?? "");
  }

  function saveEdit(index: number) {
    const name = editName.trim();
    const factor = parseFloat(editFactor);
    if (!name || !factor || factor <= 0) return;
    if (conversions.some((c, i) => i !== index && c.name.toLowerCase() === name.toLowerCase())) {
      toast.error(`"${name}" already defined`);
      return;
    }
    setConversions((prev) => prev.map((c, i) => i === index ? { ...c, name, conversionFactor: factor, barcode: editBarcode.trim() } : c));
    setEditingIdx(null);
  }

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);

    const res = await fetch("/api/upload", { method: "POST", body: fd });
    setUploading(false);

    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error ?? "Upload failed");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const { url } = await res.json();
    set("imageUrl", url);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const url = isEdit ? `/api/products/${product!.id}` : "/api/products";
    const method = isEdit ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        reorderPoint: parseInt(form.reorderPoint) || 0,
        imageUrl: form.imageUrl || null,
        unitConversions: conversions.map((c) => ({
          name: c.name,
          conversionFactor: c.conversionFactor,
          barcode: c.barcode || null,
        })),
      }),
    });

    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      toast.error(data.error ?? "Failed to save product");
      return;
    }

    if (isEdit) {
      toast.success("Product updated");
      router.push("/products");
      router.refresh();
    } else {
      setSavedProduct(data as SavedProduct);
    }
  }

  function handleAddAnother() {
    setSavedProduct(null);
    setForm(EMPTY_FORM);
    setConversions([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ── Post-save card ────────────────────────────────────────────────────────
  if (savedProduct) {
    return (
      <div className="max-w-2xl">
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center gap-3 mb-5">
            <span className="text-2xl">✅</span>
            <div>
              <div className="font-semibold text-slate-800 text-sm">
                Product saved — {savedProduct.name}{savedProduct.colorVariant ? ` ${savedProduct.colorVariant}` : ""}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                Code: <span className="font-mono">{savedProduct.sku}</span>
                &nbsp;·&nbsp;
                Barcode: <span className="font-mono">{savedProduct.barcode}</span>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-6">
            <div className="bg-white border-2 border-dashed border-slate-300 rounded-lg px-5 py-4 flex flex-col items-center gap-1.5 flex-shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/barcodes/${encodeURIComponent(savedProduct.barcode)}`}
                alt={savedProduct.barcode}
                className="w-40 h-auto"
              />
              <div className="font-mono text-[10px] text-slate-500 tracking-wider">{savedProduct.barcode}</div>
              <div className="text-xs font-semibold text-center text-slate-700">
                {savedProduct.name}{savedProduct.colorVariant ? ` — ${savedProduct.colorVariant}` : ""}
              </div>
              <div className="text-[10px] text-slate-400">{savedProduct.unit.name} · {savedProduct.sku}</div>
            </div>

            <div className="flex flex-col gap-2">
              <Link
                href={`/barcodes?productId=${savedProduct.id}`}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                🖨 Print Label
              </Link>
              <button
                onClick={handleAddAnother}
                className="px-4 py-2 text-xs border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors text-left"
              >
                + Add Another
              </button>
              <Link
                href="/products"
                className="px-4 py-2 text-xs border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
              >
                ← Back to Products
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-6 max-w-2xl space-y-5">
      {/* Barcode auto-generate notice — create only */}
      {!isEdit && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-start gap-3">
          <span className="text-green-600 text-base leading-none mt-0.5">▣</span>
          <div>
            <div className="text-xs font-semibold text-green-700">Barcode Auto-Generated</div>
            <div className="text-xs text-green-600 mt-0.5">
              A unique Code-128 barcode will be created automatically when you save this product. You can print the label immediately after saving.
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">Product Name *</label>
          <input value={form.name} onChange={(e) => set("name", e.target.value)} required
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g. Button #12 Black" />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            {isEdit ? "SKU *" : "Internal Code / SKU"}
          </label>
          <input
            value={form.sku}
            onChange={(e) => set("sku", e.target.value)}
            required={isEdit}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={isEdit ? "BTN-001" : "e.g. BTN-001 (auto if blank)"}
          />
          {!isEdit && (
            <p className="text-xs text-slate-400 mt-1">Leave blank to auto-generate</p>
          )}
        </div>

        {/* Barcode — edit mode only */}
        {isEdit && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Barcode *</label>
            <div className="flex gap-2">
              <input value={form.barcode} onChange={(e) => set("barcode", e.target.value)} required
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="MR…" />
              <button type="button" onClick={() => set("barcode", generateBarcode())}
                className="px-3 py-2 text-xs border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 whitespace-nowrap">
                Generate
              </button>
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Category *</label>
          <select value={form.categoryId} onChange={(e) => set("categoryId", e.target.value)} required
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Select category…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Base Unit *</label>
          <select value={form.unitId} onChange={(e) => { set("unitId", e.target.value); setConversions([]); }} required
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Select unit…</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Reorder Point</label>
          <input type="number" inputMode="numeric" min="0" value={form.reorderPoint} onChange={(e) => set("reorderPoint", e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <p className="text-xs text-slate-400 mt-1">Alert when total stock falls below this</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Color / Variant</label>
          <input value={form.colorVariant} onChange={(e) => set("colorVariant", e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g. Black, White, Red…" />
        </div>

        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">Description / Notes</label>
          <textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={2}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            placeholder="Optional details about this product…" />
        </div>

        {/* ── Packaging / Higher Units ─────────────────────────── */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">Packaging Units</label>
          <p className="text-xs text-slate-400 mb-2">
            Define larger units for this product. Stock is always stored in the base unit.
          </p>

          {conversions.length > 0 && (
            <div className="space-y-1 mb-3">
              {conversions.map((c, i) => (
                <div key={i} className="flex items-center gap-2 bg-blue-50 border border-blue-100 px-3 py-1.5 rounded-lg text-xs">
                  {editingIdx === i ? (
                    <>
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveEdit(i); } if (e.key === "Escape") setEditingIdx(null); }}
                        className="w-28 px-2 py-1 border border-blue-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                        autoFocus
                      />
                      <span className="text-blue-500 shrink-0">=</span>
                      <input
                        type="number" inputMode="decimal" min="1" step="any"
                        value={editFactor}
                        onChange={(e) => setEditFactor(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveEdit(i); } if (e.key === "Escape") setEditingIdx(null); }}
                        className="w-20 px-2 py-1 border border-blue-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                      />
                      <span className="text-blue-500 shrink-0">{baseUnitName}</span>
                      <input
                        value={editBarcode}
                        onChange={(e) => setEditBarcode(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveEdit(i); } if (e.key === "Escape") setEditingIdx(null); }}
                        placeholder="Unit barcode"
                        className="w-36 px-2 py-1 border border-blue-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white font-mono"
                      />
                      <button type="button" onClick={() => setEditBarcode(generateBarcode())}
                        className="px-2 py-1 text-[10px] border border-blue-200 rounded text-blue-500 hover:bg-blue-100 whitespace-nowrap">
                        Gen
                      </button>
                      <button type="button" onClick={() => saveEdit(i)} className="text-blue-600 font-semibold hover:underline ml-1">Save</button>
                      <button type="button" onClick={() => setEditingIdx(null)} className="text-slate-400 hover:text-slate-600">Cancel</button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-blue-800 font-medium">
                        1 {c.name} = {c.conversionFactor} {baseUnitName}
                        {c.barcode && <span className="ml-2 text-slate-400 font-mono font-normal">{c.barcode}</span>}
                      </span>
                      <button type="button" onClick={() => startEdit(i)} className="text-slate-500 hover:text-blue-600 hover:underline">Edit</button>
                      <button type="button" onClick={() => removeConversion(i)} className="text-red-400 hover:text-red-600 leading-none text-sm font-medium">×</button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="block text-[10px] text-slate-400 mb-0.5">Unit name</label>
              <input
                value={newConvName}
                onChange={(e) => setNewConvName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addConversion(); } }}
                placeholder="e.g. Box"
                disabled={!form.unitId}
                className="w-32 px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-400 mb-0.5">
                = how many {form.unitId ? baseUnitName : "base units"}
              </label>
              <input
                type="number" inputMode="decimal" min="1" step="any"
                value={newConvFactor}
                onChange={(e) => setNewConvFactor(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addConversion(); } }}
                placeholder="e.g. 12"
                disabled={!form.unitId}
                className="w-24 px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-400 mb-0.5">Barcode <span className="text-slate-300">(auto if blank)</span></label>
              <div className="flex gap-1">
                <input
                  value={newConvBarcode}
                  onChange={(e) => setNewConvBarcode(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addConversion(); } }}
                  placeholder="Auto-generate"
                  disabled={!form.unitId}
                  className="w-36 px-2 py-1.5 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40"
                />
                <button type="button" onClick={() => setNewConvBarcode(generateBarcode())}
                  disabled={!form.unitId}
                  className="px-2 py-1.5 text-xs border border-slate-300 rounded-lg text-slate-500 hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap">
                  Gen
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={addConversion}
              disabled={!form.unitId || !newConvName.trim() || !newConvFactor || parseFloat(newConvFactor) <= 0}
              className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg disabled:opacity-40 transition-colors"
            >
              + Add
            </button>
          </div>
          {!form.unitId && (
            <p className="text-xs text-slate-400 mt-1">Select a base unit first</p>
          )}
        </div>

        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">Product Image</label>
          <div className="flex items-start gap-4">
            {form.imageUrl ? (
              <div className="w-24 h-24 rounded-lg border border-slate-200 overflow-hidden flex-shrink-0 bg-slate-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={form.imageUrl} alt="Product" className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="w-24 h-24 rounded-lg border-2 border-dashed border-slate-200 flex items-center justify-center flex-shrink-0 bg-slate-50 text-slate-300 text-xs text-center leading-tight">
                No image
              </div>
            )}
            <div className="flex flex-col gap-2 justify-center">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleImageChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {uploading ? "Uploading…" : form.imageUrl ? "Change image" : "Upload image"}
              </button>
              {form.imageUrl && (
                <button
                  type="button"
                  onClick={() => {
                    set("imageUrl", "");
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="px-3 py-1.5 text-xs border border-red-200 rounded-lg text-red-500 hover:bg-red-50"
                >
                  Remove
                </button>
              )}
              <p className="text-xs text-slate-400">JPG, PNG, WEBP or GIF · max 5 MB</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={saving || uploading}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors">
          {saving ? "Saving…" : isEdit ? "Save Changes" : "✓ Save & Generate Barcode"}
        </button>
        <button type="button" onClick={() => router.back()}
          className="px-5 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
          Cancel
        </button>
      </div>
    </form>
  );
}
