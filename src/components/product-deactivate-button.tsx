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

  async function toggle() {
    if (isActive && !confirm("Deactivate this product? It will no longer be available for receiving (GRN).")) return;
    setLoading(true);
    const res = await fetch(`/api/products/${productId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    });
    setLoading(false);
    if (!res.ok) { toast.error("Failed to update product"); return; }
    toast.success(isActive ? "Product deactivated" : "Product reactivated");
    router.refresh();
  }

  async function deleteProduct() {
    if (!confirm("Permanently delete this product? This cannot be undone.")) return;
    setLoading(true);
    const res = await fetch(`/api/products/${productId}`, { method: "DELETE" });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { toast.error(data.error ?? "Failed to delete product"); return; }
    toast.success("Product deleted");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={toggle}
        disabled={loading}
        className={`text-xs hover:underline disabled:opacity-50 ${
          isActive ? "text-red-500 hover:text-red-700" : "text-green-600 hover:text-green-800"
        }`}
      >
        {loading ? "…" : isActive ? "Deactivate" : "Reactivate"}
      </button>
      {!isActive && userRole === "ADMIN" && (
        <button
          onClick={deleteProduct}
          disabled={loading}
          className="text-xs text-red-400 hover:text-red-600 hover:underline disabled:opacity-50"
        >
          Delete
        </button>
      )}
    </div>
  );
}
