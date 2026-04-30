"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

export default function CancelOpnameButton({ sessionId, sessionNumber }: { sessionId: string; sessionNumber: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function cancel() {
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

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-2 text-xs">
        <span className="text-slate-500">Cancel session?</span>
        <button onClick={() => setConfirming(false)} className="text-slate-500 hover:text-slate-700 underline">No</button>
        <button onClick={cancel} disabled={loading} className="text-red-600 hover:text-red-800 font-semibold underline disabled:opacity-50">
          {loading ? "…" : "Yes"}
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      disabled={loading}
      className="text-xs text-red-500 hover:text-red-700 hover:underline disabled:opacity-50"
    >
      Cancel
    </button>
  );
}
