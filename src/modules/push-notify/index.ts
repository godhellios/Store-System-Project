// ── push-notify module ─────────────────────────────────────────────────────
// Free browser push notifications — no third-party service, no API key.
// Uses Web Push (VAPID) + service worker. Works on Chrome/Edge/Android.
// iOS: requires adding the site to Home Screen first (Safari 16.4+).
//
// Integration points (only places this module touches the main app):
//   1. src/app/api/orders/route.ts
//      - imports: sendPushNotification  (called after GOODS_OUT created)
//   2. src/app/(app)/settings/page.tsx
//      - imports: PushSubscribeButton   (rendered in Notifications tab)
//   3. public/sw.js                     (service worker — standalone file)
//   4. .env / Vercel env vars:
//      VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, NEXT_PUBLIC_VAPID_PUBLIC_KEY
//
// To disconnect: say "disconnect push notification module"
//   → removes those 2 import lines, deletes this folder + public/sw.js,
//     removes VAPID env vars from Vercel.
// ──────────────────────────────────────────────────────────────────────────

export { PUSH_SUBSCRIPTIONS_KEY } from "./config";

// Server-only — import directly in route handlers, not in client components
// import { sendPushNotification } from "@/modules/push-notify/send";

// Client component — safe to import in "use client" files
export { PushSubscribeButton } from "./subscribe-button";
