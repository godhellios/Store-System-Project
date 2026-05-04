"use client";

import { useState } from "react";

type Format = "a4" | "dotmatrix";

const PAGE_STYLE: Record<Format, string> = {
  a4:        `@page { size: A4; margin: 0; }`,
  dotmatrix: `@page { size: A4; margin: 8mm 10mm; }`,
};

function injectPrintStyle(format: Format) {
  document.getElementById("dyn-print-style")?.remove();
  const s = document.createElement("style");
  s.id = "dyn-print-style";
  s.textContent = PAGE_STYLE[format];
  document.head.appendChild(s);
  document.body.classList.toggle("dotmatrix", format === "dotmatrix");
}

export function PrintActions({ orderId }: { orderId: string }) {
  const [format, setFormat] = useState<Format>("a4");

  function selectFormat(f: Format) {
    setFormat(f);
    // Apply immediately so the screen preview reflects the mode
    document.body.classList.toggle("dotmatrix", f === "dotmatrix");
  }

  function handlePrint() {
    injectPrintStyle(format);
    fetch(`/api/orders/${orderId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ printedAt: true }),
    }).catch(() => {});
    setTimeout(() => window.print(), 100);
  }

  return (
    <div className="flex items-center gap-3">
      {/* Format selector */}
      <div className="flex items-center gap-1 bg-slate-700 rounded-lg p-0.5">
        <button
          onClick={() => selectFormat("a4")}
          className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
            format === "a4" ? "bg-white text-slate-800" : "text-slate-300 hover:text-white"
          }`}
        >
          A4 Paper
        </button>
        <button
          onClick={() => selectFormat("dotmatrix")}
          className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
            format === "dotmatrix" ? "bg-white text-slate-800" : "text-slate-300 hover:text-white"
          }`}
        >
          Dot Matrix
        </button>
      </div>

      <button
        onClick={handlePrint}
        className="text-xs bg-white text-slate-800 font-semibold px-4 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
      >
        Print / Save PDF
      </button>
      <button
        onClick={() => {
          window.close();
          setTimeout(() => { window.location.href = "/orders"; }, 150);
        }}
        className="text-xs text-slate-300 hover:text-white px-3 py-1.5 rounded-lg hover:bg-slate-700 transition-colors"
      >
        Close
      </button>
    </div>
  );
}
