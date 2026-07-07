"use client";

// Tiny print toolbar for the opname count sheet (hidden when printing).
export function OpnameSheetPrintActions({ title }: { title: string }) {
  return (
    <div className="no-print" style={{ position: "sticky", top: 0, zIndex: 10, background: "#0f172a", color: "white", padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => window.print()} style={{ background: "#2563eb", color: "white", border: "none", borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          Print / Save PDF
        </button>
        <button onClick={() => window.close()} style={{ background: "transparent", color: "white", border: "1px solid #334155", borderRadius: 8, padding: "6px 14px", fontSize: 13, cursor: "pointer" }}>
          Close
        </button>
      </div>
    </div>
  );
}
