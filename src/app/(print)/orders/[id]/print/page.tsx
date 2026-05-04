import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { PrintActions } from "./print-actions";

export default async function DeliveryOrderPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      fromLocation: true,
      toLocation: true,
      lines: {
        include: { product: { include: { unit: true, category: true } } },
        orderBy: { id: "asc" },
      },
    },
  });

  if (!order || order.type !== "GOODS_OUT") notFound();

  // Clean date without locale "pukul" artifact
  const tz = "Asia/Jakarta";
  const datePart = order.createdAt.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: tz });
  const timePart = order.createdAt.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  const date = `${datePart}, ${timePart} WIB`;

  const totalBaseQty  = order.lines.reduce((s, l) => s + l.quantity, 0);
  const hasConversion = order.lines.some(l => l.inputQty != null);
  const hasNotes      = order.lines.some(l => l.notes);

  // Column count changes based on data
  const colCount = 5 + (hasConversion ? 2 : 0) + (hasNotes ? 1 : 0);

  return (
    <>
      <style>{`
        /* ── Page setup ─────────────────────────────── */
        @page { size: A4; margin: 0; }
        @media print {
          .no-print { display: none !important; }
          html, body { background: white !important; margin: 0 !important; }
          .preview-bg { background: white !important; padding: 0 !important; min-height: 0 !important; }
        }
        @media screen {
          .preview-bg { background: #94a3b8; padding: 32px 0; min-height: 100vh; }
        }

        /* ── Document wrapper ───────────────────────── */
        .doc-wrap {
          font-family: Arial, Helvetica, sans-serif;
          color: #111;
          width: 210mm;
          min-height: 297mm;
          padding: 14mm 16mm;
          margin: 0 auto;
          background: white;
          box-sizing: border-box;
        }

        /* ── Table base ─────────────────────────────── */
        .doc-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 8mm;
          font-size: 9pt;
          color: #111;
        }
        .doc-table th {
          padding: 5px 6px;
          font-weight: 700;
          font-size: 8pt;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          white-space: nowrap;
          border: 1px solid #1e293b;
          color: #fff;
          background: #1e293b;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .doc-table td {
          padding: 5px 6px;
          color: #111;
          vertical-align: middle;
          border: 1px solid #cbd5e1;
          font-size: 9pt;
        }
        .doc-table tbody tr:nth-child(even) td {
          background: #f8fafc;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .doc-table tfoot td {
          background: white !important;
          border: none;
          border-top: 2px solid #1e293b;
          padding-top: 6px;
        }
        .r { text-align: right; }
        .c { text-align: center; }

        /* ── Dot-matrix overrides ───────────────────── */
        body.dotmatrix .doc-table th {
          background: white !important;
          color: black !important;
          border: 1.5px solid black !important;
          -webkit-print-color-adjust: economy;
          print-color-adjust: economy;
        }
        body.dotmatrix .doc-table td,
        body.dotmatrix .doc-table tbody tr:nth-child(even) td {
          background: white !important;
          color: black !important;
          border: 1px solid #666 !important;
        }
        body.dotmatrix .doc-table tfoot td {
          border-top: 2px solid black !important;
          border-left: none !important; border-right: none !important; border-bottom: none !important;
        }
        body.dotmatrix .doc-header-rule { border-color: black !important; border-bottom-width: 2px !important; }
        body.dotmatrix .doc-sig-box     { border-color: black !important; }
        body.dotmatrix * { color: black !important; }
      `}</style>

      {/* ── Screen toolbar ───────────────────────────── */}
      <div className="no-print bg-slate-800 text-white px-6 py-3 flex items-center justify-between">
        <span style={{ fontSize: "13px", fontWeight: 600 }}>Delivery Order — {order.orderNumber}</span>
        <PrintActions orderId={id} />
      </div>

      {/* ── Preview wrapper ──────────────────────────── */}
      <div className="preview-bg">
        <div className="doc-wrap shadow-2xl print:shadow-none">

          {/* ════ HEADER ════════════════════════════════ */}
          <div className="doc-header-rule" style={{
            display: "flex", justifyContent: "space-between", alignItems: "flex-start",
            borderBottom: "2.5px solid #1e293b", paddingBottom: "10px", marginBottom: "12px",
          }}>
            {/* Left: brand */}
            <div>
              <div style={{ fontSize: "24pt", fontWeight: 900, color: "#0f172a", lineHeight: 1, letterSpacing: "-0.5px" }}>
                MR<span style={{ color: "#0284c7" }}>Is</span>
              </div>
              <div style={{ fontSize: "8pt", color: "#444", marginTop: "4px", letterSpacing: "0.02em" }}>
                Mitra Ramah Inventory System
              </div>
            </div>
            {/* Right: document type + number */}
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "16pt", fontWeight: 800, letterSpacing: "3px", textTransform: "uppercase", color: "#0f172a" }}>
                Surat Jalan
              </div>
              <div style={{ fontSize: "9pt", color: "#444", marginTop: "1px", letterSpacing: "0.5px" }}>
                Delivery Order
              </div>
              <div style={{ fontSize: "12pt", fontFamily: "Courier New, monospace", fontWeight: 700, color: "#0f172a", marginTop: "4px", letterSpacing: "1px" }}>
                {order.orderNumber}
              </div>
            </div>
          </div>

          {/* ════ META INFO ══════════════════════════════ */}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr",
            columnGap: "20px", rowGap: "3px",
            marginBottom: "12px",
            padding: "8px 10px",
            border: "1px solid #e2e8f0",
            borderRadius: "2px",
            background: "#fafafa",
          }}>
            <MetaRow label="Tanggal"     value={date} />
            <MetaRow label="No. DO"      value={order.orderNumber} mono />
            {order.fromLocation  && <MetaRow label="Dari"        value={order.fromLocation.name} />}
            {order.customer      && <MetaRow label="Customer"    value={order.customer} />}
            {order.reference     && <MetaRow label="Referensi"   value={order.reference} />}
            {order.createdByName && <MetaRow label="Dibuat oleh" value={order.createdByName} />}
            {order.notes && (
              <div style={{ gridColumn: "1 / -1", display: "flex", gap: "10px", paddingTop: "5px", marginTop: "3px", borderTop: "1px solid #e2e8f0" }}>
                <span style={{ color: "#333", minWidth: "80px", flexShrink: 0, fontWeight: 700, fontSize: "8.5pt" }}>Catatan</span>
                <span style={{ color: "#111", fontSize: "9.5pt", lineHeight: 1.4 }}>{order.notes}</span>
              </div>
            )}
          </div>

          {/* ════ ITEMS TABLE ════════════════════════════ */}
          <table className="doc-table">
            <thead>
              <tr>
                <th className="c" style={{ width: "20px" }}>#</th>
                <th>Nama Barang</th>
                <th style={{ width: "76px" }}>SKU</th>
                <th className="r" style={{ width: "44px" }}>Qty</th>
                <th style={{ width: "52px" }}>Satuan</th>
                {hasConversion && <th className="r" style={{ width: "52px" }}>Base Qty</th>}
                {hasConversion && <th style={{ width: "52px" }}>Satuan</th>}
                {hasNotes      && <th style={{ width: "72px" }}>Catatan</th>}
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line, i) => (
                <tr key={line.id}>
                  <td className="c" style={{ color: "#555", fontSize: "8pt" }}>{i + 1}</td>
                  <td style={{ fontWeight: 600, color: "#111" }}>
                    {line.product.name}
                  </td>
                  <td style={{ fontFamily: "Courier New, monospace", fontSize: "8pt", color: "#333" }}>
                    {line.product.sku}
                  </td>
                  <td className="r" style={{ fontWeight: 700, color: "#111" }}>
                    {line.inputQty != null ? line.inputQty : line.quantity}
                  </td>
                  <td style={{ color: "#222" }}>
                    {line.inputQty != null ? line.inputUnit : line.product.unit.name}
                  </td>
                  {hasConversion && (
                    <td className="r" style={{ color: "#333" }}>
                      {line.inputQty != null ? line.quantity : "—"}
                    </td>
                  )}
                  {hasConversion && (
                    <td style={{ color: "#333" }}>
                      {line.inputQty != null ? line.product.unit.name : ""}
                    </td>
                  )}
                  {hasNotes && (
                    <td style={{ color: "#444", fontSize: "8pt" }}>{line.notes ?? ""}</td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                {hasConversion ? (
                  <>
                    {/* label spans: # + Nama + SKU + Qty + Satuan = 5 */}
                    <td colSpan={5} className="r" style={{ fontWeight: 600, color: "#333", fontSize: "8.5pt" }}>
                      Total — {order.lines.length} item{order.lines.length !== 1 ? "s" : ""}
                    </td>
                    <td className="r" style={{ fontWeight: 800, color: "#0f172a", fontSize: "10pt", letterSpacing: "0.02em" }}>
                      {totalBaseQty.toLocaleString("id-ID")}
                    </td>
                    <td colSpan={hasNotes ? 2 : 1} style={{ color: "#444", fontSize: "8.5pt" }}>
                      base unit
                    </td>
                  </>
                ) : (
                  <>
                    {/* label spans: # + Nama + SKU = 3 */}
                    <td colSpan={3} className="r" style={{ fontWeight: 600, color: "#333", fontSize: "8.5pt" }}>
                      Total — {order.lines.length} item{order.lines.length !== 1 ? "s" : ""}
                    </td>
                    <td className="r" style={{ fontWeight: 800, color: "#0f172a", fontSize: "10pt", letterSpacing: "0.02em" }}>
                      {totalBaseQty.toLocaleString("id-ID")}
                    </td>
                    <td colSpan={hasNotes ? 2 : 1} style={{ color: "#444", fontSize: "8.5pt" }}>
                      {order.lines[0]?.product.unit.name ?? "unit"}
                    </td>
                  </>
                )}
              </tr>
            </tfoot>
          </table>

          {/* ════ SIGNATURE BOXES ════════════════════════ */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px", marginTop: "10mm" }}>
            {(["Dibuat Oleh", "Diperiksa Oleh", "Diterima Oleh"] as const).map((label) => (
              <div key={label}>
                <div style={{ fontSize: "8.5pt", fontWeight: 700, color: "#222", marginBottom: "4px", textAlign: "center" }}>
                  {label}
                </div>
                <div className="doc-sig-box" style={{ height: "52px", border: "1px solid #aaa" }} />
                <div style={{ marginTop: "4px", display: "flex", justifyContent: "space-between", borderTop: "1px solid #ccc", paddingTop: "3px" }}>
                  {["Ttd", "Nama", "Tgl"].map(h => (
                    <span key={h} style={{ fontSize: "7pt", color: "#666", flex: 1, textAlign: "center" }}>{h}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* ════ FOOTER ════════════════════════════════ */}
          <div className="doc-footer" style={{
            marginTop: "10mm", paddingTop: "4px",
            borderTop: "1px solid #e2e8f0",
            fontSize: "7pt", color: "#888", textAlign: "center", letterSpacing: "0.02em",
          }}>
            MRIs – Mitra Ramah Inventory System &nbsp;·&nbsp; {order.orderNumber} &nbsp;·&nbsp; Dicetak: {date}
          </div>

        </div>
      </div>
    </>
  );
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "6px", padding: "1px 0" }}>
      <span style={{ color: "#333", minWidth: "82px", flexShrink: 0, fontWeight: 700, fontSize: "8.5pt" }}>
        {label}
      </span>
      <span style={{ color: "#555", fontSize: "8pt", marginRight: "4px" }}>:</span>
      <span style={{ color: "#111", fontWeight: 500, fontSize: "9.5pt", fontFamily: mono ? "Courier New, monospace" : "inherit" }}>
        {value}
      </span>
    </div>
  );
}
