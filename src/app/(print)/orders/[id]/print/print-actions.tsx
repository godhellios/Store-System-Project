"use client";

import { useEffect } from "react";
// ── whatsapp-do module ──────────────────────────────────────────────────────
import { openWhatsApp } from "@/modules/whatsapp-do";
// ────────────────────────────────────────────────────────────────────────────

export function PrintActions({
  orderId,
  waPhone,
  waMessage,
}: {
  orderId: string;
  waPhone: string;
  waMessage: string;
}) {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, []);

  function handlePrint() {
    // window.print() blocks until the print dialog is dismissed,
    // then WhatsApp opens automatically after the user confirms.
    window.print();
    // ── whatsapp-do module ──────────────────────────────────────────────
    openWhatsApp(waPhone, waMessage);
    // ────────────────────────────────────────────────────────────────────
  }

  return (
    <div className="flex gap-2 items-center">
      <span className="text-xs text-slate-400 flex items-center gap-1.5">
        <span>📱</span>
        <span>WhatsApp sent after print</span>
      </span>
      <button
        onClick={handlePrint}
        className="text-xs bg-white text-slate-800 font-semibold px-4 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
      >
        Print / Save PDF
      </button>
      <button
        onClick={() => window.close()}
        className="text-xs text-slate-300 hover:text-white px-3 py-1.5 rounded-lg hover:bg-slate-700 transition-colors"
      >
        Close
      </button>
    </div>
  );
}
