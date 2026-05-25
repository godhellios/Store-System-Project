"use client";

import { useState } from "react";
import toast from "react-hot-toast";

type Props = {
  orderId: string;
  initialPrinted: boolean;
  labelPrintedAt: string | null;
  labelPrintedByName: string | null;
  compact?: boolean; // compact = list row chip, false = detail page full row
};

export function LabelPrintedToggle({
  orderId,
  initialPrinted,
  labelPrintedAt,
  labelPrintedByName,
  compact = false,
}: Props) {
  const [printed, setPrinted] = useState(initialPrinted);
  const [printedAt, setPrintedAt] = useState(labelPrintedAt);
  const [printedByName, setPrintedByName] = useState(labelPrintedByName);
  const [loading, setLoading] = useState(false);

  async function toggle(next: boolean) {
    setLoading(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/label-printed`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printed: next }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setPrinted(data.labelPrinted);
      setPrintedAt(data.labelPrintedAt ?? null);
      setPrintedByName(data.labelPrintedByName ?? null);
      toast.success(next ? "Label ditandai sudah dicetak" : "Tanda cetak dihapus");
    } catch {
      toast.error("Gagal menyimpan");
    } finally {
      setLoading(false);
    }
  }

  if (compact) {
    return (
      <button
        onClick={() => toggle(!printed)}
        disabled={loading}
        title={printed && printedAt ? `Dicetak oleh ${printedByName} · ${new Date(printedAt).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric" })}` : "Tandai label sudah dicetak"}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors border ${
          printed
            ? "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
            : "bg-amber-50 text-amber-600 border-amber-200 hover:bg-amber-100"
        } ${loading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <span className={`w-3 h-3 rounded-sm border flex items-center justify-center flex-shrink-0 ${printed ? "bg-green-600 border-green-600" : "border-amber-400 bg-white"}`}>
          {printed && (
            <svg className="w-2 h-2 text-white" viewBox="0 0 12 12" fill="none">
              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        Label
      </button>
    );
  }

  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${printed ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
      <button
        onClick={() => toggle(!printed)}
        disabled={loading}
        className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
          printed ? "bg-green-600 border-green-600" : "border-amber-400 bg-white hover:border-amber-500"
        } ${loading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
      >
        {printed && (
          <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-semibold ${printed ? "text-green-800" : "text-amber-700"}`}>
          {printed ? "Label sudah dicetak" : "Label belum dicetak"}
        </div>
        {printed && printedAt && (
          <div className="text-xs text-green-600 mt-0.5">
            Oleh <span className="font-medium">{printedByName ?? "Admin"}</span>
            {" · "}
            {new Date(printedAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" })}
          </div>
        )}
        {!printed && (
          <div className="text-xs text-amber-600 mt-0.5">Klik untuk tandai sudah dicetak</div>
        )}
      </div>
      {printed && (
        <button
          onClick={() => toggle(false)}
          disabled={loading}
          className="text-xs text-green-600 hover:text-green-800 underline flex-shrink-0 mt-0.5"
        >
          Undo
        </button>
      )}
    </div>
  );
}
