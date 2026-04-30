// ── whatsapp-do module ──────────────────────────────────────────────────────
// Sends Delivery Order summary to WhatsApp via wa.me link (no API required).
//
// Integration points (the only places this module touches the main app):
//   1. src/components/transaction-form.tsx
//      - imports: openWhatsApp, buildDOMessage, WA_DO_PHONE_DEFAULT
//      - sends WhatsApp when user clicks "Print DO" after saving a Goods Out
//   2. src/app/(app)/orders/[id]/page.tsx
//      - imports: buildDOMessage, WA_DO_PHONE_KEY, WA_DO_PHONE_DEFAULT
//      - builds waMessage server-side, passes to WhatsAppResendButton
//   3. src/components/whatsapp-resend-button.tsx
//      - imports: openWhatsApp
//      - "📱 WhatsApp" button shown in order detail header
//   4. src/app/api/settings/route.ts  (generic settings, not WA-specific)
//   5. src/app/(app)/settings/page.tsx — NotificationsManager phone input
//
// To disconnect: delete this folder, remove imports + references from above.
// ────────────────────────────────────────────────────────────────────────────

export { WA_DO_PHONE_KEY, WA_DO_PHONE_DEFAULT } from "./config";
export { buildDOMessage } from "./message-builder";
export type { DOMessageData } from "./message-builder";

export function openWhatsApp(phone: string, message: string): void {
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}
