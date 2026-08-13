import { prisma } from "@/lib/prisma";
import { packingViews } from "@/lib/packing-units";
import { notFound } from "next/navigation";
import bwipjs from "bwip-js";
import { getT } from "@/modules/i18n";
import { SheetPrintActions } from "./sheet-print-actions";

export const dynamic = "force-dynamic";

function makeSvg(text: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let svg: string = (bwipjs as any).toSVG({
    bcid: "code128",
    text,
    scale: 3,
    height: 12,
    includetext: false,
    backgroundcolor: "FFFFFF",
  });
  svg = svg.replace("<svg ", '<svg shape-rendering="crispEdges" ');
  return svg;
}

export default async function BarcodeSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ categoryId?: string; search?: string; units?: string }>;
}) {
  const { categoryId, search, units } = await searchParams;
  if (!categoryId) notFound();

  const includeUnits = units === "1";
  const searchTrim = search?.trim() ?? "";

  const [t, category, products] = await Promise.all([
    getT(),
    prisma.category.findUnique({ where: { id: categoryId } }),
    prisma.product.findMany({
      where: {
        categoryId,
        isActive: true,
        AND: [{ OR: [{ approvalStatus: "ACTIVE" as const }, { approvalStatus: null }] }],
        ...(searchTrim ? { name: { contains: searchTrim, mode: "insensitive" } } : {}),
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        unitConversions: {
          select: { id: true, barcode: true, unit: { select: { name: true, conversionFactor: true } } },
          orderBy: { unit: { conversionFactor: "asc" } },
        },
      },
    }),
  ]);

  if (!category) notFound();

  const rows = products.map((p) => ({
    ...p,
    svg: makeSvg(p.barcode),
    unitRows: includeUnits
      ? packingViews(p.unitConversions)
          .filter((u) => u.barcode)
          .map((u) => ({ ...u, svg: makeSvg(u.barcode!) }))
      : [],
  }));

  const date = new Date().toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });

  const productsWord = t("barcodes.sheet.products", "products");
  const title = `${t("barcodes.sheet.docTitle", "Barcode Sheet")} — ${category.name}${searchTrim ? ` · "${searchTrim}"` : ""} · ${rows.length} ${productsWord}`;

  return (
    <>
      <style>{`
        @page { size: A4 portrait; margin: 10mm 14mm; }
        @media print {
          .no-print { display: none !important; }
          html, body { background: white !important; margin: 0 !important; }
          .preview-bg { background: white !important; padding: 0 !important; min-height: 0 !important; }
        }
        @media screen {
          .preview-bg { background: #94a3b8; padding: 24px 0; min-height: 100vh; }
        }

        .sheet {
          font-family: Arial, Helvetica, sans-serif;
          color: #111;
          width: 210mm;
          min-height: 297mm;
          padding: 10mm 14mm;
          margin: 0 auto;
          background: white;
          box-sizing: border-box;
        }

        /* ── Header ─── */
        .sheet-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          border-bottom: 2.5px solid #0f172a;
          padding-bottom: 8px;
          margin-bottom: 8px;
        }
        .sheet-brand { font-size: 22pt; font-weight: 900; color: #0f172a; line-height: 1; letter-spacing: -0.5px; }
        .sheet-brand span { color: #0284c7; }
        .sheet-brand-sub { font-size: 7.5pt; color: #555; margin-top: 3px; letter-spacing: 0.03em; }
        .sheet-meta { text-align: right; }
        .sheet-category { font-size: 13pt; font-weight: 800; color: #0f172a; }
        .sheet-subtitle { font-size: 8pt; color: #555; margin-top: 2px; }

        /* ── Product rows ─── */
        .product-row {
          page-break-inside: avoid;
          break-inside: avoid;
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 5px 0;
          border-bottom: 1px solid #e2e8f0;
        }
        .product-row:last-child { border-bottom: none; }

        .row-num {
          flex-shrink: 0;
          width: 6mm;
          font-size: 7pt;
          color: #94a3b8;
          padding-top: 4px;
          text-align: right;
        }
        .barcode-col {
          flex-shrink: 0;
          width: 65mm;
        }
        .barcode-col svg { display: block; width: 100%; height: auto; }

        .info-col {
          flex: 1;
          min-width: 0;
          padding-top: 3px;
        }
        .product-name { font-size: 9.5pt; font-weight: 700; color: #0f172a; line-height: 1.3; }
        .product-sku  { font-size: 7.5pt; font-family: "Courier New", monospace; color: #475569; margin-top: 2px; }

        /* ── Packing unit sub-rows ─── */
        .unit-list {
          margin-top: 4px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding-left: 2mm;
          border-left: 2px solid #e2e8f0;
          margin-left: 2mm;
        }
        .unit-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .unit-barcode-wrap {
          flex-shrink: 0;
          width: 46mm;
        }
        .unit-barcode-wrap svg { display: block; width: 100%; height: auto; }
        .unit-label {
          display: flex;
          flex-direction: column;
        }
        .unit-name { font-size: 7.5pt; color: #334155; font-weight: 600; }
        .unit-code { font-size: 6.5pt; font-family: "Courier New", monospace; color: #94a3b8; }

        /* ── Footer ─── */
        .sheet-footer {
          margin-top: 8mm;
          padding-top: 4px;
          border-top: 1px solid #e2e8f0;
          font-size: 7pt;
          color: #94a3b8;
          text-align: center;
          letter-spacing: 0.03em;
        }
      `}</style>

      <SheetPrintActions
        title={title}
        printLabel={t("barcodes.sheet.printButton", "Print / Save PDF")}
        closeLabel={t("barcodes.sheet.close", "Close")}
      />

      <div className="preview-bg">
        <div className="sheet shadow-2xl print:shadow-none">

          {/* Header */}
          <div className="sheet-header">
            <div>
              <div className="sheet-brand">MR<span>Is</span></div>
              <div className="sheet-brand-sub">Mitra Ramah Inventory System</div>
            </div>
            <div className="sheet-meta">
              <div className="sheet-category">{category.name}</div>
              <div className="sheet-subtitle">
                {rows.length} {productsWord}
                {searchTrim ? ` · ${t("barcodes.sheet.filterLabel", "filter")}: "${searchTrim}"` : ""}
                {includeUnits ? ` · ${t("barcodes.sheet.inclPacking", "incl. packing units")}` : ""}
              </div>
              <div className="sheet-subtitle" style={{ marginTop: "2px", color: "#94a3b8" }}>
                {t("barcodes.sheet.printedAt", "Printed")}: {date}
              </div>
            </div>
          </div>

          {/* Empty state */}
          {rows.length === 0 && (
            <div style={{ padding: "20mm 0", textAlign: "center", color: "#94a3b8", fontSize: "11pt" }}>
              {t("barcodes.sheet.empty", "No products found.")}
            </div>
          )}

          {/* Product rows */}
          {rows.map((p, i) => (
            <div key={p.id} className="product-row">
              <div className="row-num">{i + 1}</div>
              <div className="barcode-col" dangerouslySetInnerHTML={{ __html: p.svg }} />
              <div className="info-col">
                <div className="product-name">{p.name}</div>
                <div className="product-sku">{p.sku}</div>
                {p.unitRows.length > 0 && (
                  <div className="unit-list">
                    {p.unitRows.map((u) => (
                      <div key={u.id} className="unit-row">
                        <div className="unit-barcode-wrap" dangerouslySetInnerHTML={{ __html: u.svg }} />
                        <div className="unit-label">
                          <span className="unit-name">{u.name}</span>
                          <span className="unit-code">{u.barcode}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Footer */}
          <div className="sheet-footer">
            MRIs – Mitra Ramah Inventory System &nbsp;·&nbsp; {category.name} &nbsp;·&nbsp; {t("barcodes.sheet.printedAt", "Printed")}: {date}
          </div>

        </div>
      </div>
    </>
  );
}
