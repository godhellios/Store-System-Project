"use client";

import { useState } from "react";

export function PrintSetupNotice() {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("print_setup_dismissed") === "1";
  });

  if (dismissed) return null;

  function dismiss() {
    localStorage.setItem("print_setup_dismissed", "1");
    setDismissed(true);
  }

  return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex gap-3 items-start">
      <span className="text-amber-500 text-lg leading-none mt-0.5">⚠</span>
      <div className="flex-1 text-sm text-amber-800">
        <p className="font-semibold mb-1">First-time Chrome print setup required</p>
        <p className="text-amber-700 text-xs">When the print dialog opens: set <strong>Destination</strong> → your label printer · <strong>Paper size</strong> → your label size (e.g. 40×60 mm) · <strong>Margins</strong> → None · <strong>Scale</strong> → 100%. Chrome remembers this per printer — one-time setup only.</p>
      </div>
      <button onClick={dismiss} className="text-amber-400 hover:text-amber-600 text-lg leading-none font-bold flex-shrink-0" title="Dismiss">×</button>
    </div>
  );
}
