"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";

export function OrderActions({
  orderId,
  userRole,
  cancelledAt,
  adjustmentStatus,
}: {
  orderId: string;
  userRole: string;
  cancelledAt?: string | null;
  adjustmentStatus?: string | null;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [cancelConfirming, setCancelConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  async function handleDelete() {
    setDeleting(true);
    const res = await fetch(`/api/orders/${orderId}`, { method: "DELETE" });
    const data = await res.json();
    setDeleting(false);
    if (!res.ok) { toast.error(data.error ?? "Failed to delete order"); return; }
    toast.success("Order deleted — stock reversed");
    router.push("/orders");
    router.refresh();
  }

  async function handleCancel() {
    setCancelling(true);
    const res = await fetch(`/api/orders/${orderId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: cancelReason }),
    });
    const data = await res.json();
    setCancelling(false);
    if (!res.ok) { toast.error(data.error ?? "Failed to cancel order"); return; }
    toast.success("Order cancelled — stock reversed");
    setCancelConfirming(false);
    setCancelReason("");
    router.refresh();
  }

  const isAdmin = userRole === "ADMIN";
  const canEdit = ["ADMIN", "STAFF"].includes(userRole) && !cancelledAt;
  const canCancel = isAdmin && !cancelledAt && adjustmentStatus !== "PENDING";
  const canDelete = isAdmin;

  if (!canEdit && !canCancel && !canDelete) return null;

  return (
    <div className="flex gap-2 items-center flex-wrap">
      {canEdit && (
        <Link href={`/orders/${orderId}/edit`}
          className="text-xs px-3 py-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
          Edit
        </Link>
      )}

      {/* Cancel order */}
      {canCancel && (
        cancelConfirming ? (
          <div className="flex flex-col gap-2 border border-red-200 bg-red-50 rounded-xl px-4 py-3 min-w-[260px]">
            <p className="text-xs font-semibold text-red-700">Cancel this order and reverse stock?</p>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Reason (optional)…"
              rows={2}
              className="w-full px-2 py-1.5 text-xs border border-red-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-400 resize-none bg-white"
            />
            <div className="flex gap-2">
              <button onClick={handleCancel} disabled={cancelling}
                className="text-xs px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg disabled:opacity-50">
                {cancelling ? "Cancelling…" : "Confirm Cancel"}
              </button>
              <button onClick={() => { setCancelConfirming(false); setCancelReason(""); }}
                className="text-xs px-3 py-1.5 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
                Back
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setCancelConfirming(true)}
            className="text-xs px-3 py-2 border border-red-300 text-red-600 hover:bg-red-50 font-semibold rounded-lg transition-colors">
            Cancel Order
          </button>
        )
      )}

      {/* Delete order */}
      {canDelete && (
        deleteConfirming ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600">Delete permanently?</span>
            <button onClick={() => setDeleteConfirming(false)}
              className="text-xs px-3 py-1.5 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
              Back
            </button>
            <button onClick={handleDelete} disabled={deleting}
              className="text-xs px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg disabled:opacity-50">
              {deleting ? "Deleting…" : "Yes, delete"}
            </button>
          </div>
        ) : (
          <button onClick={() => setDeleteConfirming(true)} disabled={deleting}
            className="text-xs px-3 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors disabled:opacity-50">
            Delete
          </button>
        )
      )}
    </div>
  );
}
