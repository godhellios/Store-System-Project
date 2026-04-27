"use client";

import { useEffect } from "react";

export function PrintActions({ orderId }: { orderId: string }) {
  useEffect(() => {
    // Give the page a moment to render before auto-printing
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flex gap-2">
      <button
        onClick={() => window.print()}
        className="text-xs bg-white text-slate-800 font-semibold px-4 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
      >
        Print / Save PDF
      </button>
      <button
        onClick={() => window.close()}
        className="text-xs text-slate-300 hover:text-white px-3 py-1.5 rounded-lg hover:bg-slate-700 transition-colors"
      >
        Close
      </button>
    </div>
  );
}
