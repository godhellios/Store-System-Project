"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { useT } from "@/modules/i18n/provider";

type Location = { id: string; name: string };
type ProductResult = { id: string; sku: string; name: string };
type AdjLine = { productId: string; productName: string; productSku: string; direction: "add" | "remove"; qty: number; reason: string };
type PendingOrder = {
  id: string; orderNumber: string; createdAt: Date | string; createdByName: string | null;
  adjustmentReason: string | null; notes: string | null;
  toLocation: { name: string } | null;
  lines: { quantity: number; product: { name: string; sku: string } }[];
};

export function AdjustmentClient({
  locations, pendingOrders, role, userName,
}: {
  locations: Location[];
  pendingOrders: PendingOrder[];
  role: string;
  userName: string;
}) {
  const router = useRouter();
  const t = useT();
  const isAdmin = role === "ADMIN";

  const REASONS = [
    t("adjustment.reasons.damage", "Damage"),
    t("adjustment.reasons.loss", "Loss / Missing"),
    t("adjustment.reasons.countCorrection", "Count Correction"),
    t("adjustment.reasons.returnCustomer", "Return from Customer"),
    t("adjustment.reasons.returnSupplier", "Return to Supplier"),
    t("adjustment.reasons.openingStock", "Opening Stock"),
    t("adjustment.reasons.other", "Other"),
  ];

  // ── Form state ────────────────────────────────────────────────────────────
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [lines, setLines] = useState<AdjLine[]>([
    { productId: "", productName: "", productSku: "", direction: "add", qty: 1, reason: REASONS[0] },
  ]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // ── Product search state per line ─────────────────────────────────────────
  const [search, setSearch] = useState<Record<number, { q: string; results: ProductResult[]; open: boolean }>>({});
  const blurTimers = {} as Record<number, ReturnType<typeof setTimeout>>;

  const searchProducts = useCallback(async (idx: number, q: string) => {
    setSearch((s) => ({ ...s, [idx]: { q, open: true, results: s[idx]?.results ?? [] } }));
    if (q.trim().length < 1) { setSearch((s) => ({ ...s, [idx]: { q, open: false, results: [] } })); return; }
    try {
      const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) {
        clearTimeout(blurTimers[idx]);
        setSearch((s) => ({ ...s, [idx]: { ...s[idx], results: data.slice(0, 8), open: true } }));
      }
    } catch { /* ignore */ }
  }, []);

  function assignProduct(idx: number, p: ProductResult) {
    setLines((prev) => prev.map((l, i) => i === idx ? { ...l, productId: p.id, productName: p.name, productSku: p.sku } : l));
    setSearch((s) => ({ ...s, [idx]: { q: `${p.sku} — ${p.name}`, results: [], open: false } }));
  }

  function addLine() {
    setLines((prev) => [...prev, { productId: "", productName: "", productSku: "", direction: "add", qty: 1, reason: REASONS[0] }]);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateLine<K extends keyof AdjLine>(idx: number, key: K, value: AdjLine[K]) {
    setLines((prev) => prev.map((l, i) => i === idx ? { ...l, [key]: value } : l));
  }

  async function handleSubmit() {
    if (!locationId) { toast.error("Select a location"); return; }
    const validLines = lines.filter((l) => l.productId && l.qty > 0);
    if (!validLines.length) { toast.error("Add at least one product with quantity"); return; }

    setSaving(true);
    try {
      const apiLines = validLines.map((l) => ({
        productId: l.productId,
        quantity: l.direction === "add" ? l.qty : -l.qty,
        notes: l.reason,
      }));
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "ADJUSTMENT",
          toLocationId: locationId,
          adjustmentReason: validLines.map((l) => l.reason).join(", "),
          notes: notes || null,
          lines: apiLines,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Failed to submit"); return; }
      toast.success("Adjustment request submitted — waiting for admin approval");
      setLines([{ productId: "", productName: "", productSku: "", direction: "add", qty: 1, reason: REASONS[0] }]);
      setNotes("");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  // ── Approve / Reject ──────────────────────────────────────────────────────
  const [reviewNote, setReviewNote] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState<string | null>(null);

  async function handleReview(orderId: string, action: "approve" | "reject") {
    setReviewing(orderId);
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: reviewNote[orderId] ?? "" }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Failed"); return; }
      toast.success(action === "approve" ? "Adjustment approved — stock updated" : "Adjustment rejected");
      router.refresh();
    } finally {
      setReviewing(null);
    }
  }

  return (
    <div className="max-w-2xl space-y-8">

      {/* ── Submission form ─────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-5 space-y-5">
        <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("adjustment.submitTitle", "Submit Adjustment Request")}</div>

        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{t("adjustment.location", "Location")}</label>
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>

        <div className="space-y-3">
          {lines.map((line, idx) => (
            <div key={idx} className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 space-y-2">
              {/* Product search */}
              <div className="relative">
                <input
                  type="text"
                  placeholder={t("adjustment.searchProduct", "Search product by name or SKU…")}
                  value={search[idx]?.q ?? (line.productId ? `${line.productSku} — ${line.productName}` : "")}
                  onChange={(e) => searchProducts(idx, e.target.value)}
                  onBlur={() => { blurTimers[idx] = setTimeout(() => setSearch((s) => ({ ...s, [idx]: { ...s[idx], open: false } })), 200); }}
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-slate-200"
                />
                {search[idx]?.open && (search[idx]?.results?.length ?? 0) > 0 && (
                  <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg shadow-lg">
                    {search[idx].results.map((p) => (
                      <button key={p.id} type="button" onMouseDown={() => assignProduct(idx, p)}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 dark:hover:bg-slate-700 flex gap-2">
                        <span className="font-mono text-slate-400">{p.sku}</span>
                        <span className="text-slate-700 dark:text-slate-200">{p.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-2 items-center flex-wrap">
                {/* Direction */}
                <select
                  value={line.direction}
                  onChange={(e) => updateLine(idx, "direction", e.target.value as "add" | "remove")}
                  className="px-2 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="add">{t("adjustment.addToStock", "+ Add to stock")}</option>
                  <option value="remove">{t("adjustment.removeFromStock", "- Remove from stock")}</option>
                </select>

                {/* Quantity */}
                <input
                  type="number"
                  min={1}
                  value={line.qty}
                  onChange={(e) => updateLine(idx, "qty", Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-20 px-2 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-slate-200"
                />

                {/* Reason */}
                <select
                  value={line.reason}
                  onChange={(e) => updateLine(idx, "reason", e.target.value)}
                  className="flex-1 min-w-[140px] px-2 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {REASONS.map((r) => <option key={r}>{r}</option>)}
                </select>

                {lines.length > 1 && (
                  <button type="button" onClick={() => removeLine(idx)}
                    className="text-slate-300 hover:text-red-400 text-base leading-none flex-shrink-0">✕</button>
                )}
              </div>
            </div>
          ))}

          <button type="button" onClick={addLine}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium">
            {t("adjustment.addAnotherProduct", "+ Add another product")}
          </button>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{t("adjustment.notesOptional", "Notes (optional)")}</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder={t("adjustment.contextPlaceholder", "Additional context for the reviewer…")}
            className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-slate-200"
          />
        </div>

        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-4 py-3 text-xs text-amber-800 dark:text-amber-300">
          {t("adjustment.reviewNotice", "This request will be sent to admin for review. Stock will only change after approval.")}
        </div>

        <button
          onClick={handleSubmit}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg"
        >
          {saving ? t("adjustment.submitting", "Submitting…") : t("adjustment.submitBtn", "Submit for Approval")}
        </button>
      </div>

      {/* ── Pending adjustments (admin review) ─────────────────────────── */}
      {pendingOrders.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t("adjustment.pendingTitle", "Pending Approval")} ({pendingOrders.length})
            {!isAdmin && <span className="ml-2 text-xs font-normal text-slate-400">{t("adjustment.awaitingReview", "— awaiting admin review")}</span>}
          </div>

          {pendingOrders.map((order) => (
            <div key={order.id} className="bg-white dark:bg-slate-900 rounded-xl border border-amber-200 dark:border-amber-700 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{order.orderNumber}</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {new Date(order.createdAt).toLocaleString()} · {order.createdByName ?? "Unknown"} · {order.toLocation?.name}
                  </div>
                  {order.notes && <div className="text-xs text-slate-500 mt-1 italic">&quot;{order.notes}&quot;</div>}
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 flex-shrink-0">PENDING</span>
              </div>

              <div className="space-y-1">
                {order.lines.map((line, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                    <span className={`font-semibold ${line.quantity >= 0 ? "text-green-600" : "text-red-500"}`}>
                      {line.quantity >= 0 ? `+${line.quantity}` : line.quantity}
                    </span>
                    <span>{line.product.name}</span>
                    <span className="font-mono text-slate-400">{line.product.sku}</span>
                  </div>
                ))}
              </div>

              {isAdmin && (
                <div className="pt-2 border-t border-slate-100 dark:border-slate-700 space-y-2">
                  <input
                    type="text"
                    placeholder={t("adjustment.reviewPlaceholder", "Review note (optional)…")}
                    value={reviewNote[order.id] ?? ""}
                    onChange={(e) => setReviewNote((r) => ({ ...r, [order.id]: e.target.value }))}
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-slate-200"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleReview(order.id, "approve")}
                      disabled={reviewing === order.id}
                      className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-semibold px-4 py-1.5 rounded-lg"
                    >
                      {reviewing === order.id ? "…" : t("adjustment.approve", "Approve")}
                    </button>
                    <button
                      onClick={() => handleReview(order.id, "reject")}
                      disabled={reviewing === order.id}
                      className="bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-semibold px-4 py-1.5 rounded-lg"
                    >
                      {t("adjustment.reject", "Reject")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {pendingOrders.length === 0 && (
        <div className="text-xs text-slate-400 text-center py-4">{t("adjustment.noPending", "No pending adjustments")}</div>
      )}
    </div>
  );
}
