"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";

export function OrderActions({ orderId, userRole }: { orderId: string; userRole: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    const res = await fetch(`/api/orders/${orderId}`, { method: "DELETE" });
    const data = await res.json();
    setDeleting(false);
    if (!res.ok) {
      toast.error(data.error ?? "Failed to delete order");
      return;
    }
    toast.success("Order deleted — stock reversed");
    router.push("/orders");
    router.refresh();
  }

  const canEdit = ["ADMIN", "STAFF"].includes(userRole);
  const canDelete = userRole === "ADMIN";

  if (!canEdit && !canDelete) return null;

  return (
    <div className="flex gap-2 items-center flex-wrap">
      {canEdit && (
        <Link
          href={`/orders/${orderId}/edit`}
          className="text-xs px-3 py-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50"
        >
          Edit
        </Link>
      )}
      {canDelete && (
        confirming ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600">Delete and reverse stock?</span>
            <button onClick={() => setConfirming(false)} className="text-xs px-3 py-1.5 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={handleDelete} disabled={deleting}
              className="text-xs px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg disabled:opacity-50">
              {deleting ? "Deleting…" : "Yes, delete"}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            disabled={deleting}
            className="text-xs px-3 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors disabled:opacity-50"
          >
            Delete
          </button>
        )
      )}
    </div>
  );
}
