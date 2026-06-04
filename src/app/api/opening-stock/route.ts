import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import {
  validateOpeningStockRows,
  applySkipProtect,
  importableRows,
  computeOpeningStockCosts,
  type ParsedRow,
} from "@/lib/opening-stock";

export const maxDuration = 60;

// ── GET — download CSV template pre-filled with all active products ──────────

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [products, locations] = await Promise.all([
    prisma.product.findMany({
      // Only products that have no balance anywhere yet — opening stock is a
      // first-time-only set. Already-stocked products are changed via Adjustment.
      where: { isActive: true, stock: { none: { quantity: { gt: 0 } } } },
      select: { sku: true, name: true, category: { select: { name: true } } },
      orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
    }),
    prisma.location.findMany({
      where: { isActive: true },
      select: { name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const locationList = locations.map((l) => l.name).join(", ");
  const csvLines = [
    "# Opening Stock Import — MRIS",
    `# Valid locations: ${locationList}`,
    "# This template lists only products with NO stock yet — fill in their opening balances.",
    "# To open an already-stocked product at a NEW location, add its SKU as a new row manually.",
    "# ProductName column is for reference only — parser uses SKU.",
    "# Leave Qty blank or 0 to skip a row.",
    "SKU,ProductName,Location,Qty,UnitCost",
    ...products.map((p) => `${p.sku},"${p.name.replace(/"/g, '""')}",,,`),
  ];

  return new Response(csvLines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="opening-stock-template.csv"',
    },
  });
}

// ── POST — validate (confirm:false) or import (confirm:true) ─────────────────

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json()) as { rows: ParsedRow[]; confirm: boolean };
  const { rows, confirm } = body;

  if (!Array.isArray(rows) || rows.length === 0)
    return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const [products, locations] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, sku: true, name: true },
    }),
    prisma.location.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    }),
  ]);

  const validated = validateOpeningStockRows(rows, products, locations);

  // Protect existing balances. Runs in both preview and import so the skip
  // decision shown in the preview is identical to what the import actually does.
  const productIds = validated
    .filter((r) => (r.status === "ok" || r.status === "warning") && r.productId)
    .map((r) => r.productId!);
  if (productIds.length > 0) {
    const existingStock = await prisma.stock.findMany({
      where: { productId: { in: productIds }, quantity: { gt: 0 } },
      select: { productId: true, locationId: true, quantity: true },
    });
    applySkipProtect(validated, existingStock);
  }

  const hasErrors = validated.some((r) => r.status === "error");

  if (!confirm || hasErrors) {
    return NextResponse.json({ rows: validated, hasErrors });
  }

  // ── Import ────────────────────────────────────────────────────────────────
  const toImport = importableRows(validated);

  // Everything was skipped/errored — nothing to write.
  if (toImport.length === 0) {
    return NextResponse.json({ rows: validated, hasErrors: false, imported: 0 });
  }

  const avgByProduct = computeOpeningStockCosts(toImport);

  // Atomic: the stock insert and the cost updates succeed or fail together, so a
  // mid-import failure can never leave stock set with stale costs.
  await prisma.$transaction(async (tx) => {
    // Single bulk insert — one SQL round-trip regardless of row count.
    // Every targeted combo was verified to have no balance above, so this only
    // creates rows; the ON CONFLICT clause remains as a safety net against a race
    // with a concurrent write.
    await tx.$executeRaw`
      INSERT INTO "Stock" (id, "productId", "locationId", quantity, "updatedAt")
      VALUES ${Prisma.join(
        toImport.map((r) =>
          Prisma.sql`(${crypto.randomUUID()}, ${r.productId!}, ${r.locationId!}, ${r.qty}, NOW())`
        )
      )}
      ON CONFLICT ("productId", "locationId") DO UPDATE
        SET quantity = EXCLUDED.quantity, "updatedAt" = NOW()
    `;

    // Update product costs (one update per distinct product)
    for (const [productId, avgCost] of avgByProduct) {
      await tx.product.update({
        where: { id: productId },
        data: { lastCost: avgCost, avgCost },
      });
    }
  });

  writeAuditLog({
    session,
    action: "IMPORT_OPENING_STOCK",
    description: `Imported opening stock: ${toImport.length} line(s) across ${new Set(toImport.map((r) => r.locationId)).size} location(s)`,
  });

  return NextResponse.json({ rows: validated, hasErrors: false, imported: toImport.length });
}
