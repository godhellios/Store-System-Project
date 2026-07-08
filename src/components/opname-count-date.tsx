"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Backdated opname — count-date display + admin editor.
//
// Shows the session's business count date ("counted at end of this day") and,
// for admins while the session is still IN_PROGRESS/REVIEWING, lets them move
// it to the day the count physically happened. Saving re-baselines every
// line's book qty to the stock as of that date (server-side), so a count
// entered late still adjusts correctly.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { useT } from "@/modules/i18n/provider";

type Props = {
  sessionId: string;
  /** Effective count date (countDate ?? createdAt), ISO string. */
  currentDate: string;
  /** True when the date differs from the session's creation day (backdated). */
  isBackdated: boolean;
  canEdit: boolean; // admin && (IN_PROGRESS || REVIEWING)
};

const toJakartaDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" });

export function OpnameCountDate({ sessionId, currentDate, isBackdated, canEdit }: Props) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => toJakartaDay(currentDate));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const today = toJakartaDay(new Date().toISOString());

  async function save() {
    if (!reason.trim()) {
      toast.error(t("opname.date.reasonRequired", "Please enter a reason"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/opname/${sessionId}/date`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countDate: date, reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t("common.saveFailed", "Failed to save"));
      toast.success(
        t("opname.date.saved", "Count date updated — book quantities recalculated for that date")
      );
      setOpen(false);
      setReason("");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.saveFailed", "Failed to save"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span>
          {t("opname.date.label", "Count date")}:{" "}
          <span className="font-semibold text-slate-700">{fmtDay(currentDate)}</span>
        </span>
        {isBackdated && (
          <span className="bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded font-medium">
            {t("opname.date.backdated", "Backdated")}
          </span>
        )}
        {canEdit && !open && (
          <button onClick={() => setOpen(true)} className="text-sky-600 hover:text-sky-800 underline">
            {t("opname.date.change", "Change date")}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2 p-3 rounded-xl border border-sky-200 bg-sky-50 flex flex-col gap-2 max-w-sm">
          <label className="text-xs font-semibold text-slate-600">
            {t("opname.date.editLabel", "When was this count physically done?")}
          </label>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm"
          />
          <p className="text-xs text-slate-500">
            {t(
              "opname.date.hint",
              "Book quantities will be recalculated to the stock at the end of that day, so transactions entered after the count don't distort the differences."
            )}
          </p>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("opname.date.reasonPlaceholder", "Reason (e.g. counted Sunday, entered Monday)")}
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
              onClick={() => { setOpen(false); setReason(""); setDate(toJakartaDay(currentDate)); }}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 text-sm hover:bg-slate-100"
            >
              {t("common.cancel", "Cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
