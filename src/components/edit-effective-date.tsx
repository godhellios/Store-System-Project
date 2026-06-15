"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { useT } from "@/modules/i18n/provider";
import { exceedsSoftCap } from "@/lib/effective-date";

type Props = {
  orderId: string;
  currentEffectiveDate: string; // ISO
};

// Asia/Jakarta calendar day as YYYY-MM-DD (en-CA formats that way).
const toJakartaDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

export function EditEffectiveDate({ orderId, currentEffectiveDate }: Props) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => toJakartaDay(currentEffectiveDate));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const today = toJakartaDay(new Date().toISOString());

  async function save() {
    if (!reason.trim()) {
      toast.error(t("effectiveDate.reasonRequired", "Please enter a reason"));
      return;
    }
    // Soft 90-day warning (confirm, not a block).
    const picked = new Date(`${date}T12:00:00+07:00`);
    if (exceedsSoftCap(picked, new Date())) {
      const days = Math.floor((Date.now() - picked.getTime()) / 86_400_000);
      if (!window.confirm(t("effectiveDate.softCapConfirm", `This is ${days} days ago — are you sure?`).replace("{days}", String(days))))
        return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/effective-date`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ effectiveDate: date, reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t("common.saveFailed", "Failed to save"));
      toast.success(t("effectiveDate.saved", "Date updated"));
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
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-sky-600 hover:text-sky-800 underline"
      >
        {t("effectiveDate.change", "Change date")}
      </button>
    );
  }

  return (
    <div className="mt-2 p-3 rounded-xl border border-sky-200 bg-sky-50 flex flex-col gap-2 max-w-sm">
      <label className="text-xs font-semibold text-slate-600">
        {t("effectiveDate.label", "Real date (when it happened)")}
      </label>
      <input
        type="date"
        value={date}
        max={today}
        onChange={(e) => setDate(e.target.value)}
        className="px-3 py-2 rounded-lg border border-slate-300 text-sm"
      />
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t("effectiveDate.reasonPlaceholder", "Reason (e.g. forgot to enter Monday's delivery)")}
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
          onClick={() => { setOpen(false); setReason(""); setDate(toJakartaDay(currentEffectiveDate)); }}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 text-sm hover:bg-slate-100"
        >
          {t("common.cancel", "Cancel")}
        </button>
      </div>
    </div>
  );
}
