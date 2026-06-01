"use client";

import { useState } from "react";

type LowStockItem = {
  id: string;
  quantity: number;
  product: {
    name: string;
    reorderPoint: number;
    unit: { name: string } | null;
  };
};

type Props = {
  name: string;
  headerColor: string;
  lowItems: LowStockItem[];
  labelReorderAt: string;
  labelAllStockAbove: string;
};

const PAGE_SIZE = 5;

export function LowStockCard({ name, headerColor, lowItems, labelReorderAt, labelAllStockAbove }: Props) {
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(lowItems.length / PAGE_SIZE);
  const pageItems = lowItems.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className={`px-4 py-3 text-white text-sm font-semibold flex items-center justify-between ${headerColor}`}>
        <span>{name}</span>
        {lowItems.length > 0 && (
          <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
            {lowItems.length}
          </span>
        )}
      </div>

      {/* Items */}
      {lowItems.length === 0 ? (
        <p className="px-4 py-3 text-xs text-green-600 flex items-center gap-1.5">
          <span>✓</span> {labelAllStockAbove}
        </p>
      ) : (
        <>
          {pageItems.map((s) => (
            <div
              key={s.id}
              className="flex justify-between items-center px-4 py-2.5 border-b border-slate-50 last:border-0 text-sm"
            >
              <div className="truncate mr-2">
                <div className="text-slate-700 text-xs font-medium truncate">{s.product.name}</div>
                <div className="text-[11px] text-slate-400">
                  {labelReorderAt} {s.product.reorderPoint}
                </div>
              </div>
              <span className="font-semibold text-red-500 dark:text-red-400 whitespace-nowrap text-xs">
                {s.quantity} {s.product.unit?.name?.toLowerCase() ?? ""} ⚠
              </span>
            </div>
          ))}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2 border-t border-slate-100 bg-slate-50">
              <button
                onClick={() => setPage((p) => p - 1)}
                disabled={page === 0}
                className="text-xs text-slate-500 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed px-1"
              >
                ←
              </button>
              <span className="text-[11px] text-slate-400">
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages - 1}
                className="text-xs text-slate-500 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed px-1"
              >
                →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
