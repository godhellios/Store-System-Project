"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

export default function ProductDeactivateButton({
  productId,
  isActive,
}: {
  productId: string;
  isActive: boolean;
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

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={`text-xs hover:underline disabled:opacity-50 ${
        isActive ? "text-red-500 hover:text-red-700" : "text-green-600 hover:text-green-800"
      }`}
    >
      {loading ? "…" : isActive ? "Deactivate" : "Reactivate"}
    </button>
  );
}
