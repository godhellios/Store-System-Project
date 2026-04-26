"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";

export function OrderActions({ orderId, userRole }: { orderId: string; userRole: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm("Delete this order? All stock movements will be reversed. This cannot be undone.")) return;
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
    <div className="flex gap-2">
      {canEdit && (
        <Link
          href={`/orders/${orderId}/edit`}
          className="text-xs px-3 py-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50"
        >
          Edit
        </Link>
      )}
      {canDelete && (
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="text-xs px-3 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors disabled:opacity-50"
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      )}
    </div>
  );
}
