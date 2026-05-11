"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import { useT } from "@/modules/i18n/provider";

type Category = { id: string; name: string };
type Unit = { id: string; name: string };
type UnitConversion = { id?: string; name: string; conversionFactor: number; barcode: string | null };
type Product = {
  id: string; name: string; sku: string; barcode: string;
  categoryId: string; unitId: string; reorderPoint: number;
  colorVariant: string | null; description: string | null;
  imageUrl: string | null;
  unitConversions?: UnitConversion[];
  pendingChanges?: unknown;
  pendingChangedBy?: string | null;
  pendingChangedAt?: string | Date | null;
};
type SavedProduct = {
  id: string; name: string; sku: string; barcode: string;
  colorVariant: string | null;
  category: { name: string };
  unit: { name: string };
  approvalStatus: string | null;
};
type SimilarProduct = { id: string; name: string; sku: string; score: number };

const EMPTY_FORM = {
  name: "", sku: "", barcode: "", categoryId: "", unitId: "",
  reorderPoint: "0", colorVariant: "", description: "", imageUrl: "",
};

export function ProductForm({
  categories, units, product, isAdmin = false,
}: {
  categories: Category[];
  units: Unit[];
  product?: Product;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const t = useT();
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
  const [previewSku, setPreviewSku] = useState<string | null>(null);
  const [hasPendingEdit, setHasPendingEdit] = useState(
    isEdit && !!product?.pendingChangedAt
  );
  const [cancellingPending, setCancellingPending] = useState(false);
  const [skuLoading, setSkuLoading] = useState(false);
  const [duplicates, setDuplicates] = useState<SimilarProduct[] | null>(null);

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

  // Fetch preview SKU whenever category changes (create mode only)
  const fetchPreviewSku = useCallback(async (categoryId: string) => {
    if (!categoryId || isEdit) return;
    setSkuLoading(true);
    setPreviewSku(null);
    try {
      const res = await fetch(`/api/products/preview-sku?categoryId=${categoryId}`);
      const data = await res.json();
      if (res.ok) setPreviewSku(data.sku);
      else setPreviewSku(null);
    } catch {
      setPreviewSku(null);
    } finally {
      setSkuLoading(false);
    }
  }, [isEdit]);

  useEffect(() => {
    fetchPreviewSku(form.categoryId);
  }, [form.categoryId, fetchPreviewSku]);

  const baseUnitName = units.find((u) => u.id === form.unitId)?.name ?? t("productForm.baseUnitsLabel", "base units");

  function addConversion() {
    const name = newConvName.trim();
    const factor = parseFloat(newConvFactor);
    if (!name || !factor || factor <= 0) return;
    if (conversions.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      toast.error(`"${name}" ${t("productForm.alreadyDefined", "already defined")}`);
      return;
    }
    setConversions((prev) => [...prev, { name, conversionFactor: factor, barcode: newConvBarcode.trim() || null }]);
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
      toast.error(`"${name}" ${t("productForm.alreadyDefined", "already defined")}`);
      return;
    }
    setConversions((prev) => prev.map((c, i) => i === index ? { ...c, name, conversionFactor: factor, barcode: editBarcode.trim() || null } : c));
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
      toast.error(data.error ?? t("productForm.uploadFailed", "Upload failed"));
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const { url } = await res.json();
    set("imageUrl", url);
  }

  async function doSubmit(force = false) {
    setSaving(true);
    setDuplicates(null);

    const url = isEdit ? `/api/products/${product!.id}` : "/api/products";
    const method = isEdit ? "PUT" : "POST";

    // In create mode, sku + barcode are server-generated — don't send them
    const payload = isEdit
      ? { ...form, reorderPoint: parseInt(form.reorderPoint) || 0, imageUrl: form.imageUrl || null, unitConversions: conversions.map((c) => ({ name: c.name, conversionFactor: c.conversionFactor, barcode: c.barcode || null })) }
      : { name: form.name, categoryId: form.categoryId, unitId: form.unitId, reorderPoint: parseInt(form.reorderPoint) || 0, colorVariant: form.colorVariant, description: form.description, imageUrl: form.imageUrl || null, unitConversions: conversions.map((c) => ({ name: c.name, conversionFactor: c.conversionFactor, barcode: c.barcode || null })), force };

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    setSaving(false);

    if (res.status === 409 && data.duplicates) {
      setDuplicates(data.duplicates as SimilarProduct[]);
      return;
    }

    if (!res.ok) {
      toast.error(data.error ?? t("productForm.failedSave", "Failed to save product"));
      return;
    }

    if (isEdit) {
      if (data._pendingSubmitted) {
        setHasPendingEdit(true);
        toast.success("Changes submitted for admin approval");
      } else {
        toast.success(t("productForm.saveChanges", "Changes saved"));
        router.push("/products");
        router.refresh();
      }
    } else {
      setSavedProduct(data as SavedProduct);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await doSubmit(false);
  }

  function handleAddAnother() {
    setSavedProduct(null);
    setDuplicates(null);
    setPreviewSku(null);
    setForm(EMPTY_FORM);
    setConversions([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function cancelPendingEdit() {
    if (!product) return;
    setCancellingPending(true);
    const res = await fetch(`/api/products/${product.id}/pending`, { method: "DELETE" });
    setCancellingPending(false);
    if (res.ok) {
      setHasPendingEdit(false);
      toast.success("Pending edit cancelled");
    } else {
      const data = await res.json();
      toast.error(data.error ?? "Failed to cancel");
    }
  }

  // ── Post-save card ────────────────────────────────────────────────────────
  if (savedProduct) {
    const isDraft = savedProduct.approvalStatus === "DRAFT";
    return (
      <div className="max-w-2xl">
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center gap-3 mb-5">
            <span className="text-2xl">{isDraft ? "⏳" : "✅"}</span>
            <div>
              <div className="font-semibold text-slate-800 text-sm">
                {isDraft
                  ? t("productForm.submittedForApproval", "Submitted for approval")
                  : t("productForm.saved", "Product saved")} — {savedProduct.name}{savedProduct.colorVariant ? ` ${savedProduct.colorVariant}` : ""}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {t("productForm.code", "Code:")} <span className="font-mono">{savedProduct.sku}</span>
                {!isDraft && (
                  <>
                    &nbsp;·&nbsp;
                    Barcode: <span className="font-mono">{savedProduct.barcode}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {isDraft ? (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4 text-xs text-amber-800">
              This product is pending admin review. It will appear in the product list once approved.
              The SKU <span className="font-mono font-semibold">{savedProduct.sku}</span> has been reserved.
            </div>
          ) : (
            <div className="flex items-start gap-6 mb-4">
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
                  🖨 {t("productForm.printLabel", "Print Label")}
                </Link>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <button
              onClick={handleAddAnother}
              className="px-4 py-2 text-xs border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors text-left"
            >
              {t("productForm.addAnother", "+ Add Another")}
            </button>
            <Link
              href="/products"
              className="px-4 py-2 text-xs border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
            >
              {t("productForm.backToProducts", "← Back to Products")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Duplicate warning modal ───────────────────────────────────────────────
  if (duplicates !== null) {
    return (
      <div className="max-w-2xl">
        <div className="bg-white rounded-xl border border-amber-300 p-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-xl">⚠️</span>
            <div>
              <div className="font-semibold text-slate-800 text-sm">Similar products found</div>
              <div className="text-xs text-slate-500 mt-0.5">These products have similar names. Please confirm this is a new product.</div>
            </div>
          </div>
          <div className="space-y-2 mb-5">
            {duplicates.map((d) => (
              <div key={d.id} className="flex items-center justify-between bg-amber-50 border border-amber-100 px-3 py-2 rounded-lg text-xs">
                <div>
                  <span className="font-medium text-slate-800">{d.name}</span>
                  <span className="ml-2 font-mono text-slate-400">{d.sku}</span>
                </div>
                <span className="text-amber-600 font-semibold">{Math.round(d.score * 100)}% similar</span>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => doSubmit(true)}
              disabled={saving}
              className="bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors"
            >
              {saving ? "Submitting…" : "Submit Anyway"}
            </button>
            <button
              onClick={() => setDuplicates(null)}
              className="px-5 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50"
            >
              Go Back & Edit
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-6 max-w-2xl space-y-5">
      {/* Pending edit banner — edit mode, non-admin, has pending */}
      {isEdit && hasPendingEdit && !isAdmin && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg px-4 py-3 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="text-amber-500 text-base leading-none mt-0.5">⏳</span>
            <div>
              <div className="text-xs font-semibold text-amber-700">Edit pending admin approval</div>
              <div className="text-xs text-amber-600 mt-0.5">Your changes have been submitted and are awaiting review.</div>
            </div>
          </div>
          <button
            type="button"
            onClick={cancelPendingEdit}
            disabled={cancellingPending}
            className="text-xs text-amber-700 hover:text-red-600 underline flex-shrink-0 disabled:opacity-50"
          >
            {cancellingPending ? "Cancelling…" : "Cancel pending edit"}
          </button>
        </div>
      )}

      {/* Approval notice — create mode, non-admin */}
      {!isEdit && !isAdmin && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-start gap-3">
          <span className="text-amber-500 text-base leading-none mt-0.5">⏳</span>
          <div>
            <div className="text-xs font-semibold text-amber-700">Requires Admin Approval</div>
            <div className="text-xs text-amber-600 mt-0.5">
              New products need admin review before they appear in the product list. SKU and barcode are reserved immediately.
            </div>
          </div>
        </div>
      )}

      {/* Barcode auto-generate notice — create mode, admin */}
      {!isEdit && isAdmin && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-start gap-3">
          <span className="text-green-600 text-base leading-none mt-0.5">▣</span>
          <div>
            <div className="text-xs font-semibold text-green-700">{t("productForm.barcodeAutoTitle", "Barcode Auto-Generated")}</div>
            <div className="text-xs text-green-600 mt-0.5">
              {t("productForm.barcodeAutoDesc", "A unique Code-128 barcode will be created automatically when you save this product. You can print the label immediately after saving.")}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">{t("productForm.productName", "Product Name *")}</label>
          <input value={form.name} onChange={(e) => set("name", e.target.value)} required
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g. Button #12 Black" />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            {isEdit ? t("productForm.skuEdit", "SKU") : t("productForm.skuCreate", "SKU (auto-generated)")}
          </label>
          {isEdit ? (
            <input
              value={form.sku}
              readOnly
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono bg-slate-50 text-slate-500 cursor-not-allowed"
            />
          ) : (
            <div className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 min-h-[38px]">
              {skuLoading ? (
                <span className="text-xs text-slate-400 animate-pulse">Loading preview…</span>
              ) : previewSku ? (
                <span className="font-mono text-sm text-slate-700">{previewSku}</span>
              ) : form.categoryId ? (
                <span className="text-xs text-red-500">Category has no code — set it in Settings</span>
              ) : (
                <span className="text-xs text-slate-400">Select a category to see preview</span>
              )}
            </div>
          )}
          {!isEdit && (
            <p className="text-xs text-slate-400 mt-1">{t("productForm.skuAutoHint", "Assigned automatically from category code")}</p>
          )}
        </div>

        {/* Barcode — edit mode only (admin can correct; read-only in create mode) */}
        {isEdit && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t("productForm.barcode", "Barcode *")}</label>
            <input value={form.barcode} onChange={(e) => set("barcode", e.target.value)} required
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">{t("productForm.category", "Category *")}</label>
          <select value={form.categoryId} onChange={(e) => set("categoryId", e.target.value)} required
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">{t("productForm.selectCategory", "Select category…")}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">{t("productForm.baseUnit", "Base Unit *")}</label>
          <select value={form.unitId} onChange={(e) => { set("unitId", e.target.value); setConversions([]); }} required
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">{t("productForm.selectUnit", "Select unit…")}</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">{t("productForm.reorderPoint", "Reorder Point")}</label>
          <input type="number" inputMode="numeric" min="0" value={form.reorderPoint} onChange={(e) => set("reorderPoint", e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <p className="text-xs text-slate-400 mt-1">{t("productForm.reorderHint", "Alert when total stock falls below this")}</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">{t("productForm.colorVariant", "Color / Variant")}</label>
          <input value={form.colorVariant} onChange={(e) => set("colorVariant", e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g. Black, White, Red…" />
        </div>

        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">{t("productForm.descriptionNotes", "Description / Notes")}</label>
          <textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={2}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            placeholder={t("productForm.descPlaceholder", "Optional details about this product…")} />
        </div>

        {/* ── Packaging / Higher Units ─────────────────────────── */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">{t("productForm.packagingUnits", "Packaging Units")}</label>
          <p className="text-xs text-slate-400 mb-2">
            {t("productForm.packagingHint", "Define larger units for this product. Stock is always stored in the base unit.")}
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
                        placeholder={t("productForm.unitBarcodePlaceholder", "Barcode (auto if blank)")}
                        className="w-36 px-2 py-1 border border-blue-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white font-mono"
                      />
                      <button type="button" onClick={() => saveEdit(i)} className="text-blue-600 font-semibold hover:underline ml-1">{t("common.save", "Save")}</button>
                      <button type="button" onClick={() => setEditingIdx(null)} className="text-slate-400 hover:text-slate-600">{t("common.cancel", "Cancel")}</button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-blue-800 font-medium">
                        1 {c.name} = {c.conversionFactor} {baseUnitName}
                        {c.barcode && <span className="ml-2 text-slate-400 font-mono font-normal">{c.barcode}</span>}
                        {!c.barcode && <span className="ml-2 text-slate-300 font-normal italic">barcode auto</span>}
                      </span>
                      <button type="button" onClick={() => startEdit(i)} className="text-slate-500 hover:text-blue-600 hover:underline">{t("common.edit", "Edit")}</button>
                      <button type="button" onClick={() => removeConversion(i)} className="text-red-400 hover:text-red-600 leading-none text-sm font-medium">×</button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="block text-[10px] text-slate-400 mb-0.5">{t("productForm.unitNameLabel", "Unit name")}</label>
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
                {t("productForm.howMany", "= how many")} {form.unitId ? baseUnitName : t("productForm.baseUnitsLabel", "base units")}
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
              <label className="block text-[10px] text-slate-400 mb-0.5">{t("productForm.unitBarcodeLabel", "Barcode")} <span className="text-slate-300">{t("productForm.autoIfBlank", "(auto if blank)")}</span></label>
              <input
                value={newConvBarcode}
                onChange={(e) => setNewConvBarcode(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addConversion(); } }}
                placeholder={t("productForm.autoIfBlank", "(auto if blank)")}
                disabled={!form.unitId}
                className="w-44 px-2 py-1.5 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40"
              />
            </div>
            <button
              type="button"
              onClick={addConversion}
              disabled={!form.unitId || !newConvName.trim() || !newConvFactor || parseFloat(newConvFactor) <= 0}
              className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg disabled:opacity-40 transition-colors"
            >
              {t("productForm.addUnit", "+ Add")}
            </button>
          </div>
          {!form.unitId && (
            <p className="text-xs text-slate-400 mt-1">{t("productForm.selectBaseFirst", "Select a base unit first")}</p>
          )}
        </div>

        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">{t("productForm.productImage", "Product Image")}</label>
          <div className="flex items-start gap-4">
            {form.imageUrl ? (
              <div className="w-24 h-24 rounded-lg border border-slate-200 overflow-hidden flex-shrink-0 bg-slate-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={form.imageUrl} alt="Product" className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="w-24 h-24 rounded-lg border-2 border-dashed border-slate-200 flex items-center justify-center flex-shrink-0 bg-slate-50 text-slate-300 text-xs text-center leading-tight">
                {t("productForm.noImage", "No image")}
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
                {uploading ? t("productForm.uploading", "Uploading…") : form.imageUrl ? t("productForm.changeImage", "Change image") : t("productForm.uploadImage", "Upload image")}
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
                  {t("productForm.removeImage", "Remove")}
                </button>
              )}
              <p className="text-xs text-slate-400">{t("productForm.imageHint", "JPG, PNG, WEBP or GIF · max 5 MB")}</p>
            </div>
          </div>
        </div>
      </div>

      {!isEdit && !previewSku && !!form.categoryId && !skuLoading && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-xs text-red-700">
          <span className="font-semibold shrink-0">Cannot save:</span>
          <span>The selected category has no code. Go to <strong>Settings → Categories</strong> and set a code for it first.</span>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={saving || uploading || (!isEdit && !previewSku && !!form.categoryId)}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors">
          {saving
            ? t("productForm.saving", "Saving…")
            : isEdit && isAdmin
              ? t("productForm.saveChanges", "Save Changes")
              : isEdit && !isAdmin
                ? "⏳ Submit Changes for Approval"
                : isAdmin
                  ? t("productForm.saveAndBarcode", "✓ Save & Generate Barcode")
                  : t("productForm.submitForApproval", "⏳ Submit for Approval")}
        </button>
        <button type="button" onClick={() => router.back()}
          className="px-5 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
          {t("common.cancel", "Cancel")}
        </button>
      </div>
    </form>
  );
}
