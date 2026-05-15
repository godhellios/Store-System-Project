"use client";

export function GoodsOutDetailActions({
  orderId,
}: {
  orderId: string;
}) {
  function handleReprint() {
    window.open(`/orders/${orderId}/print`, "_blank", "noopener,noreferrer");
    fetch(`/api/orders/${orderId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ printedAt: true }),
    }).catch(() => {});
  }

  return (
    <button
      onClick={handleReprint}
      className="text-xs px-3 py-2 bg-slate-700 hover:bg-slate-800 text-white font-semibold rounded-lg transition-colors"
    >
      Reprint
    </button>
  );
}
