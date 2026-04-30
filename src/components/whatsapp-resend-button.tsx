"use client";

// ── whatsapp-do module ──────────────────────────────────────────────────────
import { openWhatsApp } from "@/modules/whatsapp-do";
// ────────────────────────────────────────────────────────────────────────────

export function WhatsAppResendButton({
  waPhone,
  waMessage,
}: {
  waPhone: string;
  waMessage: string;
}) {
  return (
    <button
      onClick={() => openWhatsApp(waPhone, waMessage)}
      className="text-xs px-3 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors"
    >
      📱 WhatsApp
    </button>
  );
}
