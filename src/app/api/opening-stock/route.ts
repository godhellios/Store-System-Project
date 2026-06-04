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
  productsWithoutStockAtLocation,
  type ParsedRow,
} from "@/lib/opening-stock";

export const maxDuration = 60;

// ── GET — products that still need an opening balance AT a given location ─────
// ?locationId=<id>            → CSV template, Location column pre-filled
// ?locationId=<id>&format=json → JSON product list for the manual-add picker

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = new URL(req.url).searchParams;
  const locationId = params.get("locationId")?.trim();
  const asJson = params.get("format") === "json";
  if (!locationId) return NextResponse.json({ error: "locationId is required" }, { status: 400 });

  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: { name: true },
  });
  if (!location) return NextResponse.json({ error: "Location not found" }, { status: 404 });

  const [allProducts, stockHere] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, sku: true, name: true },
      orderBy: { name: "asc" },
    }),
    // Only balances at this location matter for the per-location filter.
    prisma.stock.findMany({
      where: { locationId, quantity: { gt: 0 } },
      select: { productId: true, locationId: true, quantity: true },
    }),
  ]);

  const products = productsWithoutStockAtLocation(allProducts, stockHere, locationId);

  if (asJson) {
    return NextResponse.json(
      { location: location.name, products: products.map((p) => ({ id: p.id, sku: p.sku, name: p.name })) },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const csvLines = [
    "# Opening Stock Import — MRIS",
    `# Location: ${location.name} (pre-filled below)`,
    "# Lists only products with NO balance at this location — fill in Qty (and optional UnitCost).",
    "# ProductName column is for reference only — parser uses SKU.",
    "# Leave Qty blank or 0 to skip a row.",
    "SKU,ProductName,Location,Qty,UnitCost",
    ...products.map(
      (p) => `${p.sku},"${p.name.replace(/"/g, '""')}","${location.name}",,`,
    ),
  ];

  return new Response(csvLines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="opening-stock-template.csv"',
      "Cache-Control": "no-store, max-age=0",
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
