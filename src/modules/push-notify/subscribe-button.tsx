"use client";

import { useState, useEffect } from "react";

function urlBase64ToUint8Array(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer;
}

type Status = "loading" | "unsupported" | "denied" | "subscribed" | "unsubscribed";

export function PushSubscribeButton({ vapidPublicKey }: { vapidPublicKey: string }) {
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setStatus(sub ? "subscribed" : "unsubscribed"))
      .catch(() => setStatus("unsubscribed"));
  }, []);

  async function handleEnable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("denied");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      const res = await fetch("/api/push-notify/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });
      if (res.ok) setStatus("subscribed");
    } catch (e) {
      console.error("Push subscribe error:", e);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await fetch("/api/push-notify/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        });
      }
      setStatus("unsubscribed");
    } catch (e) {
      console.error("Push unsubscribe error:", e);
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading") return null;

  if (status === "unsupported")
    return (
      <p className="text-xs text-slate-400">
        Push notifications are not supported on this browser. Try Chrome or Edge.
      </p>
    );

  if (status === "denied")
    return (
      <p className="text-xs text-red-500">
        Notification permission is blocked. Go to browser settings → Site settings → Notifications and allow this site.
      </p>
    );

  return (
    <div className="flex items-center gap-3">
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${
          status === "subscribed" ? "bg-green-500" : "bg-slate-300"
        }`}
      />
      <span className="text-sm text-slate-700 flex-1">
        {status === "subscribed"
          ? "This device will receive a notification when a Goods Out is confirmed"
          : "Notifications are off on this device"}
      </span>
      <button
        onClick={status === "subscribed" ? handleDisable : handleEnable}
        disabled={busy}
        className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors disabled:opacity-50 whitespace-nowrap ${
          status === "subscribed"
            ? "border border-red-200 text-red-600 hover:bg-red-50"
            : "bg-blue-600 text-white hover:bg-blue-700"
        }`}
      >
        {busy ? "…" : status === "subscribed" ? "Turn off" : "Enable on this device"}
      </button>
    </div>
  );
}
