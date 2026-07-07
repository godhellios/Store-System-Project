// ─────────────────────────────────────────────────────────────────────────────
// Photo Opname Scan — printable count sheet.
//
// Machine-readable paper form: numbered rows (row # | SKU | product | unit |
// large empty count box), "Page X of Y" printed on every page so photos can be
// uploaded in any order. Row numbers run continuously 1..N in the SAME order
// the scan route uses (product name asc) — the two MUST stay in sync.
//
// Book quantity is deliberately NOT printed (blind count). Gated on the feature
// flag: 404 when disabled.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { OPNAME_SCAN_SETTING_KEY } from "@/lib/opname-scan";
import { OpnameSheetPrintActions } from "./print-actions";

export const dynamic = "force-dynamic";

const ROWS_PER_PAGE = 20;

export default async function OpnameSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role === "OPERATOR") notFound();
  const { id } = await params;

  const [flag, opnameSession] = await Promise.all([
    prisma.systemSetting.findUnique({ where: { key: OPNAME_SCAN_SETTING_KEY } }).catch(() => null),
    prisma.opnameSession.findUnique({
      where: { id },
      select: {
        sessionNumber: true,
        location: { select: { name: true } },
        categories: { select: { name: true } },
        lines: {
          select: { id: true, product: { select: { sku: true, name: true, unit: { select: { name: true } } } } },
          orderBy: { product: { name: "asc" } },
        },
      },
    }),
  ]);

  if (flag?.value !== "1") notFound(); // feature disabled
  if (!opnameSession) notFound();

  const rows = opnameSession.lines.map((l, i) => ({
    num: i + 1,
    sku: l.product.sku,
    name: l.product.name,
    unit: l.product.unit?.name ?? "",
  }));

  // Chunk into pages for "Page X of Y".
  const pages: (typeof rows)[] = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) pages.push(rows.slice(i, i + ROWS_PER_PAGE));
  if (pages.length === 0) pages.push([]);
  const totalPages = pages.length;

  const date = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
  const cats = opnameSession.categories.length ? opnameSession.categories.map((c) => c.name).join(", ") : "All categories";
  const title = `Count sheet — ${opnameSession.sessionNumber} · ${rows.length} items`;

  return (
    <>
      <style>{`
        @page { size: A4 portrait; margin: 10mm 12mm; }
        @media print {
          .no-print { display: none !important; }
          html, body { background: white !important; margin: 0 !important; }
          .preview-bg { background: white !important; padding: 0 !important; min-height: 0 !important; }
          .sheet { box-shadow: none !important; margin: 0 auto !important; page-break-after: always; }
          .sheet:last-child { page-break-after: auto; }
        }
        @media screen { .preview-bg { background: #94a3b8; padding: 24px 0; min-height: 100vh; } }

        .sheet {
          font-family: Arial, Helvetica, sans-serif; color: #111;
          width: 210mm; min-height: 297mm; padding: 10mm 12mm;
          margin: 0 auto 20px; background: white; box-sizing: border-box;
        }
        .sheet-header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2.5px solid #0f172a; padding-bottom: 8px; margin-bottom: 4px; }
        .sheet-brand { font-size: 20pt; font-weight: 900; color: #0f172a; line-height: 1; letter-spacing: -0.5px; }
        .sheet-brand span { color: #0284c7; }
        .sheet-brand-sub { font-size: 7.5pt; color: #555; margin-top: 3px; }
        .sheet-meta { text-align: right; }
        .sheet-session { font-size: 13pt; font-weight: 800; color: #0f172a; font-family: "Courier New", monospace; }
        .sheet-sub { font-size: 8pt; color: #555; margin-top: 2px; }
        .sheet-page { font-size: 12pt; font-weight: 800; color: #0f172a; margin-top: 4px; }

        table.count { width: 100%; border-collapse: collapse; margin-top: 8px; }
        table.count th { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.04em; color: #555; text-align: left; border-bottom: 1.5px solid #0f172a; padding: 4px 6px; }
        table.count th.box-col { text-align: center; width: 30mm; }
        table.count td { border-bottom: 1px solid #cbd5e1; padding: 6px; vertical-align: middle; }
        .c-num { width: 8mm; font-size: 8pt; color: #64748b; text-align: right; }
        .c-sku { width: 34mm; font-size: 8pt; font-family: "Courier New", monospace; color: #334155; }
        .c-name { font-size: 9.5pt; font-weight: 600; color: #0f172a; }
        .c-unit { width: 18mm; font-size: 8pt; color: #64748b; }
        .c-box { width: 30mm; }
        .count-box { border: 1.5px solid #0f172a; border-radius: 3px; height: 11mm; }

        .sheet-footer { margin-top: 8mm; padding-top: 4px; border-top: 1px solid #e2e8f0; font-size: 7.5pt; color: #94a3b8; display: flex; justify-content: space-between; }
      `}</style>

      <OpnameSheetPrintActions title={title} />

      <div className="preview-bg">
        {pages.map((pageRows, p) => (
          <div key={p} className="sheet shadow-2xl">
            <div className="sheet-header">
              <div>
                <div className="sheet-brand">MR<span>Is</span></div>
                <div className="sheet-brand-sub">Stock Count Sheet · write the counted quantity in each box</div>
              </div>
              <div className="sheet-meta">
                <div className="sheet-session">{opnameSession.sessionNumber}</div>
                <div className="sheet-sub">{opnameSession.location.name} · {cats}</div>
                <div className="sheet-sub" style={{ color: "#94a3b8" }}>Printed: {date}</div>
                <div className="sheet-page">Page {p + 1} of {totalPages}</div>
              </div>
            </div>

            <table className="count">
              <thead>
                <tr>
                  <th className="c-num">#</th>
                  <th className="c-sku">SKU</th>
                  <th>Product</th>
                  <th className="c-unit">Unit</th>
                  <th className="box-col">Counted qty</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: "center", color: "#94a3b8", padding: "16mm 0" }}>No items in this session.</td></tr>
                )}
                {pageRows.map((r) => (
                  <tr key={r.num}>
                    <td className="c-num">{r.num}</td>
                    <td className="c-sku">{r.sku}</td>
                    <td className="c-name">{r.name}</td>
                    <td className="c-unit">{r.unit}</td>
                    <td className="c-box"><div className="count-box" /></td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="sheet-footer">
              <span>{opnameSession.sessionNumber} · {rows.length} items total</span>
              <span>Counted by: ____________________</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
