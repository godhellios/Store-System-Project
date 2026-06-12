"use client";

export function SheetPrintActions({
  title,
  printLabel,
  closeLabel,
}: {
  title: string;
  printLabel: string;
  closeLabel: string;
}) {
  return (
    <div className="no-print bg-slate-800 text-white px-6 py-3 flex items-center justify-between">
      <span style={{ fontSize: "13px", fontWeight: 600 }}>{title}</span>
      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
        <button
          onClick={() => window.print()}
          style={{
            background: "white",
            color: "#1e293b",
            fontWeight: 700,
            fontSize: "12px",
            padding: "6px 16px",
            borderRadius: "6px",
            border: "none",
            cursor: "pointer",
          }}
        >
          {printLabel}
        </button>
        <button
          onClick={() => window.close()}
          style={{
            color: "#94a3b8",
            fontSize: "12px",
            padding: "6px 12px",
            borderRadius: "6px",
            border: "none",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          {closeLabel}
        </button>
      </div>
    </div>
  );
}
