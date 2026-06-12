import { prisma } from "@/lib/prisma";
import { BarcodePrintPanel } from "@/components/barcode-print-panel";
import { BarcodeSheetPanel } from "@/components/barcode-sheet-panel";
import { ScanTestCard } from "@/components/scan-test-card";
import { blockViewer } from "@/lib/role-guard";
import { getT } from "@/modules/i18n";
import { labelCounts } from "@/lib/label-counts";

export const maxDuration = 30;

export default async function BarcodesPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string | string[]; copies?: string }>;
}) {
  await blockViewer();
  const t = await getT();
  const { productId, copies } = await searchParams;

  const [categories, locations, products, settingRow] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.product.findMany({
      where: {
        isActive: true,
        AND: [{ OR: [{ approvalStatus: "ACTIVE" as const }, { approvalStatus: null }] }],
      },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, sku: true, barcode: true,
        colorVariant: true, isActive: true, categoryId: true,
        category: { select: { name: true } },
        unit: { select: { name: true } },
        unitConversions: { select: { id: true, name: true, conversionFactor: true, barcode: true } },
        stock: { select: { locationId: true, quantity: true } },
      },
    }),
    prisma.systemSetting.findUnique({ where: { key: "barcode_label_settings" } }),
  ]);

  let labelSettings: { width: number; height: number; printerName?: string } | null = null;
  if (settingRow) {
    try { labelSettings = JSON.parse(settingRow.value); } catch { /* use defaults */ }
  }

  const preselect = productId
    ? Array.isArray(productId) ? productId : [productId]
    : [];

  // The `copies` param is sent by the GRN flow as `productId:baseQty[:boxFactor]`.
  // We turn each received quantity into per-unit label counts using the same
  // box/pcs rule as the re-label flow, keyed by barcode ("base" or a unit id).
  const productById = new Map(products.map((p) => [p.id, p]));
  const initialCounts: Record<string, Record<string, number>> = {};
  if (copies) {
    for (const entry of copies.split(",")) {
      const parts = entry.split(":");
      const id = parts[0];
      const baseQty = parseInt(parts[1] ?? "", 10);
      const factor = parts[2] != null ? parseFloat(parts[2]) : NaN;
      if (!id || !(baseQty > 0)) continue;
      const product = productById.get(id);

      // Find the unit conversion matching the received unit's factor (the "box").
      const boxUc = product && Number.isFinite(factor) && factor > 1
        ? product.unitConversions.find((uc) => uc.conversionFactor === factor && uc.barcode)
        : undefined;

      if (boxUc) {
        const { boxLabels, pcsLabels } = labelCounts(baseQty, factor);
        initialCounts[id] = { base: pcsLabels, [boxUc.id]: boxLabels };
      } else {
        // No packaging info — fall back to one base-unit label per received unit.
        initialCounts[id] = { base: baseQty };
      }
    }
  }

  return (
    <div>
      <h1 className="text-base font-semibold text-slate-800 mb-4">{t("barcodes.title", "Barcode Labels")}</h1>
      <ScanTestCard products={products} />
      <BarcodeSheetPanel categories={categories.map((c) => ({ id: c.id, name: c.name }))} />
      <BarcodePrintPanel
        products={products}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        locations={locations}
        preselect={preselect}
        initialCounts={initialCounts}
        labelSettings={labelSettings}
      />
    </div>
  );
}
