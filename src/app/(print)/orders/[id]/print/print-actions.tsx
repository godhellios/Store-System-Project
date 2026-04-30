"use client";

import { useState, useEffect } from "react";
// ── whatsapp-do module ──────────────────────────────────────────────────────
import { openWhatsApp } from "@/modules/whatsapp-do";
// ────────────────────────────────────────────────────────────────────────────

export function PrintActions({
  orderId,
  waPhone,
  waMessage,
}: {
  orderId: string;
  waPhone?: string;
  waMessage?: string;
}) {
  const firstPrint = !!waPhone && !!waMessage;
  const [waSent, setWaSent] = useState(false);

  // Auto-print only for reprints (no ?wa=1). For first-print the user
  // must send WhatsApp first, so they control when to print.
  useEffect(() => {
    if (firstPrint) return;
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [firstPrint]);

  return (
    <div className="flex items-center gap-2">
      {/* ── whatsapp-do module ─────────────────────────────────────────── */}
      {firstPrint && (
        waSent ? (
          <span className="text-xs text-green-400 font-medium flex items-center gap-1">
            ✓ WhatsApp sent
          </span>
        ) : (
          <button
            onClick={() => {
              openWhatsApp(waPhone!, waMessage!);
              setWaSent(true);
            }}
            className="text-xs bg-green-500 hover:bg-green-600 text-white font-semibold px-4 py-1.5 rounded-lg transition-colors"
          >
            1. Send WhatsApp
          </button>
        )
      )}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <button
        onClick={() => window.print()}
        className="text-xs bg-white text-slate-800 font-semibold px-4 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
      >
        {firstPrint ? "2. Print / Save PDF" : "Print / Save PDF"}
      </button>
      <button
        onClick={() => {
          window.close();
          setTimeout(() => { window.location.href = "/orders"; }, 150);
        }}
        className="text-xs text-slate-300 hover:text-white px-3 py-1.5 rounded-lg hover:bg-slate-700 transition-colors"
      >
        Close
      </button>
    </div>
  );
}
