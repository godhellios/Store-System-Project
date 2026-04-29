// ── whatsapp-do module ──────────────────────────────────────────────────────
// Sends Delivery Order summary to WhatsApp via wa.me link (no API required).
//
// Integration points (the only places this module touches the main app):
//   1. src/app/(print)/orders/[id]/print/page.tsx
//      - imports: buildDOMessage, WA_DO_PHONE_KEY, WA_DO_PHONE_DEFAULT
//   2. src/app/(print)/orders/[id]/print/print-actions.tsx
//      - imports: openWhatsApp
//   3. src/app/api/settings/route.ts  (generic settings, not WA-specific)
//   4. src/app/(app)/settings/page.tsx — NotificationsManager component
//
// To disconnect: delete this folder, remove the two import lines + component
// references in the files above.
// ────────────────────────────────────────────────────────────────────────────

export { WA_DO_PHONE_KEY, WA_DO_PHONE_DEFAULT } from "./config";
export { buildDOMessage } from "./message-builder";
export type { DOMessageData } from "./message-builder";

export function openWhatsApp(phone: string, message: string): void {
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}
