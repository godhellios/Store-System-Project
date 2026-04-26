"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

export default function CancelOpnameButton({ sessionId, sessionNumber }: { sessionId: string; sessionNumber: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function cancel() {
    if (!confirm(`Cancel opname session ${sessionNumber}? This cannot be undone.`)) return;
    setLoading(true);
    const res = await fetch(`/api/opname/${sessionId}`, { method: "DELETE" });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error ?? "Failed to cancel session");
      return;
    }
    toast.success(`Session ${sessionNumber} cancelled`);
    router.refresh();
  }

  return (
    <button
      onClick={cancel}
      disabled={loading}
      className="text-xs text-red-500 hover:text-red-700 hover:underline disabled:opacity-50"
    >
      {loading ? "…" : "Cancel"}
    </button>
  );
}
