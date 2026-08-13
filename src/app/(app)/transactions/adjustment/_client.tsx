"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { useT } from "@/modules/i18n/provider";
import { NumberField } from "@/components/number-field";
import { resolveEffectiveDate } from "@/lib/effective-date";
import { opnameOverrideMessage } from "@/components/opname-override-message";

type Location = { id: string; name: string };
type ProductResult = { id: string; sku: string; name: string };
type AdjLine = { productId: string; productName: string; productSku: string; direction: "add" | "remove"; qty: number | null; reason: string; currentStock: number | null; unitName: string; stockLoading: boolean };
type PendingOrder = {
  id: string; orderNumber: string; createdAt: Date | string; effectiveDate: string | null; createdByName: string | null;
  adjustmentReason: string | null; notes: string | null;
  toLocation: { name: string } | null;
  lines: { quantity: number; product: { name: string; sku: string } }[];
};

// Business date of an adjustment — what day it really happened. Legacy rows have
// no effectiveDate, so they fall back to createdAt via the shared rule.
const businessDateOf = (o: Pick<PendingOrder, "effectiveDate" | "createdAt">) =>
  resolveEffectiveDate(o.effectiveDate ? new Date(o.effectiveDate) : null, new Date(o.createdAt));

const jakartaDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

const businessDayOf = (o: Pick<PendingOrder, "effectiveDate" | "createdAt">) =>
  businessDateOf(o).toLocaleDateString("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" });

/** Backdated = it happened on a different day than the one it was typed in on. */
const isBackdated = (o: Pick<PendingOrder, "effectiveDate" | "createdAt">) =>
  jakartaDay(businessDateOf(o)) !== jakartaDay(new Date(o.createdAt));

// When it was typed in. Locale + timeZone are pinned: this renders during SSR
// (server runs UTC) and again on the client, and an unpinned toLocaleString()
// would disagree between the two — a hydration mismatch, and the wrong clock.
const enteredAt = (o: Pick<PendingOrder, "createdAt">) =>
  new Date(o.createdAt).toLocaleString("id-ID", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta",
  });

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
  const BLANK_LINE: AdjLine = { productId: "", productName: "", productSku: "", direction: "add", qty: 1, reason: REASONS[0], currentStock: null, unitName: "", stockLoading: false };
  const [lines, setLines] = useState<AdjLine[]>([{ ...BLANK_LINE }]);
  const [notes, setNotes] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(""); // admin-only backdate; "" = today
  const [saving, setSaving] = useState(false);

  // Local calendar day (Asia/Jakarta) — caps the date picker so no future date.
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

  // ── Product search state per line ─────────────────────────────────────────
  const [search, setSearch] = useState<Record<number, { q: string; results: ProductResult[]; open: boolean; loading: boolean }>>({});
  const blurTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const searchTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const searchProducts = useCallback((idx: number, q: string) => {
    setSearch((s) => ({ ...s, [idx]: { q, open: q.trim().length > 0, results: s[idx]?.results ?? [], loading: q.trim().length > 0 } }));
    if (q.trim().length < 1) return;
    clearTimeout(searchTimers.current[idx]);
    searchTimers.current[idx] = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(q.trim())}`);
        if (!res.ok) { setSearch((s) => ({ ...s, [idx]: { ...s[idx], loading: false } })); return; }
        const data = await res.json();
        if (Array.isArray(data)) {
          setSearch((s) => ({ ...s, [idx]: { ...s[idx], results: data.slice(0, 8), open: true, loading: false } }));
        }
      } catch { setSearch((s) => ({ ...s, [idx]: { ...s[idx], loading: false } })); }
    }, 300);
  }, []);

  async function fetchStockForLine(idx: number, productId: string, locId: string) {
    setLines((prev) => prev.map((l, i) => i === idx ? { ...l, stockLoading: true } : l));
    try {
      const res = await fetch(`/api/stock?productId=${encodeURIComponent(productId)}&locationId=${encodeURIComponent(locId)}`);
      if (res.ok) {
        const data = await res.json();
        setLines((prev) => prev.map((l, i) => i === idx ? { ...l, currentStock: data.quantity, unitName: data.unit, stockLoading: false } : l));
      } else {
        setLines((prev) => prev.map((l, i) => i === idx ? { ...l, stockLoading: false } : l));
      }
    } catch {
      setLines((prev) => prev.map((l, i) => i === idx ? { ...l, stockLoading: false } : l));
    }
  }

  function assignProduct(idx: number, p: ProductResult) {
    setLines((prev) => prev.map((l, i) => i === idx ? { ...l, productId: p.id, productName: p.name, productSku: p.sku, currentStock: null, unitName: "", stockLoading: false } : l));
    setSearch((s) => ({ ...s, [idx]: { q: `${p.sku} — ${p.name}`, results: [], open: false, loading: false } }));
    fetchStockForLine(idx, p.id, locationId);
  }

  function addLine() {
    setLines((prev) => [...prev, { ...BLANK_LINE }]);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateLine<K extends keyof AdjLine>(idx: number, key: K, value: AdjLine[K]) {
    setLines((prev) => prev.map((l, i) => i === idx ? { ...l, [key]: value } : l));
  }

  async function handleSubmit() {
    if (!locationId) { toast.error("Select a location"); return; }
    if (lines.some((l) => l.productId && (l.qty == null || l.qty < 1))) { toast.error("Enter a quantity for every item"); return; }
    const validLines = lines.filter((l) => l.productId && l.qty != null && l.qty > 0);
    if (!validLines.length) { toast.error("Add at least one product with quantity"); return; }

    const stillLoading = validLines.some((l) => l.stockLoading);
    if (stillLoading) {
      toast.error("Stock is still loading — please wait a moment then try again");
      return;
    }

    const wouldGoNegative = validLines.filter(
      (l) => l.direction === "remove" && l.currentStock !== null && l.currentStock - (l.qty ?? 0) < 0
    );
    if (wouldGoNegative.length) {
      toast.error(
        `Insufficient stock: ${wouldGoNegative.map((l) => `${l.productName} (has ${l.currentStock}, removing ${l.qty})`).join("; ")}`
      );
      return;
    }

    setSaving(true);
    try {
      const apiLines = validLines.map((l) => ({
        productId: l.productId,
        quantity: l.direction === "add" ? (l.qty ?? 0) : -(l.qty ?? 0),
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
          effectiveDate: effectiveDate || undefined,
          lines: apiLines,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Failed to submit"); return; }
      if (Array.isArray(data.warnings)) {
        data.warnings.forEach((w: string) => toast(w, { icon: "⚠️", duration: 6000 }));
      }
      toast.success("Adjustment request submitted — waiting for admin approval");
      setLines([{ ...BLANK_LINE }]);
      setNotes("");
      setEffectiveDate("");
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
      const send = async (confirm: boolean) => {
        const res = await fetch(`/api/orders/${orderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, note: reviewNote[orderId] ?? "", ...(confirm ? { confirm: true } : {}) }),
        });
        return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
      };
      // Approving behind a completed stock count returns a warning, not a result.
      let { ok, status, data } = await send(false);
      if (ok && data.warning === "opname") {
        if (!window.confirm(opnameOverrideMessage(t, String(data.opnameDateLabel ?? "")))) return;
        ({ ok, status, data } = await send(true));
      }
      if (!ok) { toast.error(data.error ?? `Error ${status}`); return; }
      toast.success(action === "approve" ? "Adjustment approved — stock updated" : "Adjustment rejected");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Request failed");
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
            onChange={(e) => {
              const newLocId = e.target.value;
              setLocationId(newLocId);
              lines.forEach((line, idx) => {
                if (line.productId) fetchStockForLine(idx, line.productId, newLocId);
              });
            }}
            className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>

        {isAdmin && (
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              {t("adjustment.transactionDate", "Transaction date")}
              <span className="ml-1 text-[10px] font-normal text-slate-400">
                {t("adjustment.transactionDateHint", "(defaults to today)")}
              </span>
            </label>
            <input
              type="date"
              value={effectiveDate}
              max={todayStr}
              onChange={(e) => setEffectiveDate(e.target.value)}
              className={`w-full md:w-48 px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                effectiveDate
                  ? "border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300"
                  : "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-slate-200"
              }`}
            />
          </div>
        )}

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
                  onBlur={() => { blurTimers.current[idx] = setTimeout(() => setSearch((s) => ({ ...s, [idx]: { ...s[idx], open: false } })), 200); }}
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-slate-200"
                />
                {search[idx]?.open && (
                  <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg shadow-lg overflow-hidden">
                    {search[idx].loading && (
                      <div className="px-3 py-2 text-xs text-slate-400 flex items-center gap-2">
                        <svg className="w-3 h-3 animate-spin text-blue-400" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                        Searching…
                      </div>
                    )}
                    {!search[idx].loading && search[idx].results.map((p) => (
                      <button key={p.id} type="button" onMouseDown={() => assignProduct(idx, p)}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 dark:hover:bg-slate-700 flex gap-2">
                        <span className="font-mono text-slate-400">{p.sku}</span>
                        <span className="text-slate-700 dark:text-slate-200">{p.name}</span>
                      </button>
                    ))}
                    {!search[idx].loading && search[idx].results.length === 0 && (
                      <div className="px-3 py-2 text-xs text-slate-400">No products found</div>
                    )}
                  </div>
                )}
              </div>

              {/* Stock info */}
              {line.productId && (
                <div className="flex items-center gap-3 text-xs px-0.5">
                  {line.stockLoading ? (
                    <span className="text-slate-400">Loading stock…</span>
                  ) : line.currentStock !== null ? (() => {
                    const after = line.direction === "add"
                      ? line.currentStock + (line.qty ?? 0)
                      : line.currentStock - (line.qty ?? 0);
                    const belowZero = after < 0;
                    return (
                      <>
                        <span className="text-slate-500">
                          Stock: <span className="font-semibold text-slate-700 dark:text-slate-200">{line.currentStock}</span> {line.unitName}
                        </span>
                        <span className={`font-medium ${belowZero ? "text-red-500" : "text-slate-500"}`}>
                          → After: <span className="font-semibold">{after}</span> {line.unitName}
                          {belowZero && " ⚠"}
                        </span>
                      </>
                    );
                  })() : null}
                </div>
              )}

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
                <NumberField
                  min={1}
                  value={line.qty}
                  placeholder="Qty"
                  aria-invalid={!!line.productId && line.qty == null}
                  onChange={(v) => updateLine(idx, "qty", v)}
                  className={`w-20 px-2 py-1.5 text-xs border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-slate-200 ${!!line.productId && line.qty == null ? "border-red-400 bg-red-50" : "border-slate-300 dark:border-slate-600"}`}
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
                    {businessDayOf(order)} · {order.createdByName ?? "Unknown"} · {order.toLocation?.name}
                  </div>
                  {isBackdated(order) && (
                    <div className="text-xs font-semibold text-amber-600 mt-0.5">
                      {t("adjustment.backdatedEntered", "Backdated — entered")} {enteredAt(order)}
                    </div>
                  )}
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
