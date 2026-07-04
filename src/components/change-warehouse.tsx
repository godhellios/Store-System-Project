"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { useT } from "@/modules/i18n/provider";

type OrderType = "GRN" | "GOODS_OUT" | "TRANSFER" | "ADJUSTMENT";

type Props = {
  orderId: string;
  orderType: OrderType;
  currentFromId: string | null;
  currentToId: string | null;
  locations: { id: string; name: string }[];
};

const usesFrom = (t: OrderType) => t === "GOODS_OUT" || t === "TRANSFER";
const usesTo = (t: OrderType) => t === "GRN" || t === "ADJUSTMENT" || t === "TRANSFER";

export function ChangeWarehouse({ orderId, orderType, currentFromId, currentToId, locations }: Props) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fromId, setFromId] = useState(currentFromId ?? "");
  const [toId, setToId] = useState(currentToId ?? "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setFromId(currentFromId ?? "");
    setToId(currentToId ?? "");
    setReason("");
  }

  // One PATCH attempt. Returns { ok, data } so the caller can handle the opname warning.
  async function attempt(confirm: boolean) {
    const payload: Record<string, unknown> = { reason: reason.trim(), confirm };
    if (usesFrom(orderType)) payload.fromLocationId = fromId;
    if (usesTo(orderType)) payload.toLocationId = toId;
    const res = await fetch(`/api/orders/${orderId}/warehouse`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data } as { ok: boolean; data: Record<string, unknown> };
  }

  async function save() {
    if (!reason.trim()) {
      toast.error(t("warehouseChange.reasonRequired", "Please enter a reason"));
      return;
    }
    setSaving(true);
    try {
      let { ok, data } = await attempt(false);
      // Soft opname warning — confirm to override, then re-send.
      if (ok && data.warning === "opname") {
        const label = String(data.opnameDateLabel ?? "");
        if (!window.confirm(t("warehouseChange.opnameConfirm", "This will alter a completed stock count from {date}. Proceed anyway?").replace("{date}", label))) {
          setSaving(false);
          return;
        }
        ({ ok, data } = await attempt(true));
      }
      if (!ok) throw new Error((data.error as string) || t("common.saveFailed", "Failed to save"));
      toast.success(t("warehouseChange.saved", "Warehouse updated"));
      setOpen(false);
      setReason("");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.saveFailed", "Failed to save"));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-sky-600 hover:text-sky-800 underline">
        {t("warehouseChange.change", "Change warehouse")}
      </button>
    );
  }

  const dropdown = (label: string, value: string, onChange: (v: string) => void) => (
    <div>
      <label className="text-xs font-semibold text-slate-600 block mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 rounded-lg border border-slate-300 text-sm w-full"
      >
        {locations.map((l) => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="mt-2 p-3 rounded-xl border border-sky-200 bg-sky-50 flex flex-col gap-2 max-w-sm">
      {usesFrom(orderType) && dropdown(t("warehouseChange.source", "Source warehouse"), fromId, setFromId)}
      {usesTo(orderType) && dropdown(t("warehouseChange.destination", "Destination warehouse"), toId, setToId)}
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t("warehouseChange.reasonPlaceholder", "Reason (e.g. staff selected the wrong warehouse)")}
        className="px-3 py-2 rounded-lg border border-slate-300 text-sm"
      />
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-50"
        >
          {saving ? t("common.saving", "Saving…") : t("common.save", "Save")}
        </button>
        <button
          onClick={() => { setOpen(false); reset(); }}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 text-sm hover:bg-slate-100"
        >
          {t("common.cancel", "Cancel")}
        </button>
      </div>
    </div>
  );
}
