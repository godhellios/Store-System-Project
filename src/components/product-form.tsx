"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

type Category = { id: string; name: string };
type Unit = { id: string; name: string };
type Product = {
  id: string; name: string; sku: string; barcode: string;
  categoryId: string; unitId: string; reorderPoint: number;
  colorVariant: string | null; description: string | null;
  imageUrl: string | null;
};

function generateBarcode(): string {
  return "MR" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
}

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

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
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
      }),
    });

    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      toast.error(data.error ?? "Failed to save product");
      return;
    }

    toast.success(isEdit ? "Product updated" : "Product created");
    router.push("/products");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-6 max-w-2xl space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">Product Name *</label>
          <input value={form.name} onChange={(e) => set("name", e.target.value)} required
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g. Button #12 Black" />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">SKU *</label>
          <input value={form.sku} onChange={(e) => set("sku", e.target.value)} required
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="BTN-12-BLK" />
        </div>

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

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Category *</label>
          <select value={form.categoryId} onChange={(e) => set("categoryId", e.target.value)} required
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Select category…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Unit *</label>
          <select value={form.unitId} onChange={(e) => set("unitId", e.target.value)} required
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Select unit…</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Reorder Point</label>
          <input type="number" min="0" value={form.reorderPoint} onChange={(e) => set("reorderPoint", e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <p className="text-xs text-slate-400 mt-1">Alert when total stock ≤ this number</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Color / Variant</label>
          <input value={form.colorVariant} onChange={(e) => set("colorVariant", e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g. Black, White, Red…" />
        </div>

        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
          <textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={2}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            placeholder="Optional notes…" />
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
          {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Product"}
        </button>
        <button type="button" onClick={() => router.back()}
          className="px-5 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
          Cancel
        </button>
      </div>
    </form>
  );
}
