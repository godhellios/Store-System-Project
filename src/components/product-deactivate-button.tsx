"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

export default function ProductDeactivateButton({
  productId,
  isActive,
  userRole,
}: {
  productId: string;
  isActive: boolean;
  userRole: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function toggle() {
    setLoading(true);
    const res = await fetch(`/api/products/${productId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    });
    setLoading(false);
    setConfirmDeactivate(false);
    if (!res.ok) { toast.error("Failed to update product"); return; }
    toast.success(isActive ? "Product deactivated" : "Product reactivated");
    router.refresh();
  }

  async function deleteProduct() {
    setLoading(true);
    const res = await fetch(`/api/products/${productId}`, { method: "DELETE" });
    const data = await res.json();
    setLoading(false);
    setConfirmDelete(false);
    if (!res.ok) { toast.error(data.error ?? "Failed to delete product"); return; }
    toast.success("Product deleted");
    router.refresh();
  }

  if (confirmDeactivate) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-500">Deactivate?</span>
        <button onClick={() => setConfirmDeactivate(false)} className="text-slate-500 hover:text-slate-700 underline">No</button>
        <button onClick={toggle} disabled={loading} className="text-red-600 hover:text-red-800 font-semibold underline disabled:opacity-50">
          {loading ? "…" : "Yes"}
        </button>
      </div>
    );
  }

  if (confirmDelete) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-500">Permanently delete?</span>
        <button onClick={() => setConfirmDelete(false)} className="text-slate-500 hover:text-slate-700 underline">No</button>
        <button onClick={deleteProduct} disabled={loading} className="text-red-600 hover:text-red-800 font-semibold underline disabled:opacity-50">
          {loading ? "…" : "Yes, delete"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => isActive ? setConfirmDeactivate(true) : toggle()}
        disabled={loading}
        className={`text-xs hover:underline disabled:opacity-50 ${
          isActive ? "text-red-500 hover:text-red-700" : "text-green-600 hover:text-green-800"
        }`}
      >
        {loading ? "…" : isActive ? "Deactivate" : "Reactivate"}
      </button>
      {!isActive && userRole === "ADMIN" && (
        <button
          onClick={() => setConfirmDelete(true)}
          disabled={loading}
          className="text-xs text-red-400 hover:text-red-600 hover:underline disabled:opacity-50"
        >
          Delete
        </button>
      )}
    </div>
  );
}
