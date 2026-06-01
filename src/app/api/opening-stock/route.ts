import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { writeAuditLog } from "@/lib/audit-log";

export const maxDuration = 60;

// ── GET — download CSV template pre-filled with all active products ──────────

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [products, locations] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true },
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

type ParsedRow = { sku: string; location: string; qty: string; unitCost: string };

export type ValidatedRow = {
  sku: string;
  productName: string | null;
  productId: string | null;
  location: string;
  locationId: string | null;
  qty: number;
  unitCost: number | null;
  status: "ok" | "warning" | "error";
  message?: string;
};

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
      select: { id: true, sku: true, name: true, avgCost: true },
    }),
    prisma.location.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    }),
  ]);

  const productBySku = new Map(products.map((p) => [p.sku.toLowerCase(), p]));
  const locationByName = new Map(locations.map((l) => [l.name.toLowerCase(), l]));

  // First pass — parse and validate each row
  const dedupeMap = new Map<string, ValidatedRow>(); // key: productId:locationId

  for (const raw of rows) {
    const sku = raw.sku?.trim() ?? "";
    const location = raw.location?.trim() ?? "";
    const qtyRaw = raw.qty?.trim() ?? "";
    const unitCostRaw = raw.unitCost?.trim() ?? "";

    // Skip rows the user left blank (most rows in template will be empty)
    if (!sku && !location && !qtyRaw) continue;

    const product = productBySku.get(sku.toLowerCase());
    if (!product) {
      dedupeMap.set(`err:${sku}:${location}:${Math.random()}`, {
        sku: sku || "(empty)",
        productName: null,
        productId: null,
        location,
        locationId: null,
        qty: 0,
        unitCost: null,
        status: "error",
        message: sku ? `SKU "${sku}" not found or inactive` : "SKU is required",
      });
      continue;
    }

    const loc = locationByName.get(location.toLowerCase());
    if (!loc) {
      dedupeMap.set(`err:${sku}:${location}:${Math.random()}`, {
        sku,
        productName: product.name,
        productId: product.id,
        location: location || "(empty)",
        locationId: null,
        qty: 0,
        unitCost: null,
        status: "error",
        message: location ? `Location "${location}" not found` : "Location is required",
      });
      continue;
    }

    const qty = parseInt(qtyRaw, 10);
    if (isNaN(qty) || qty <= 0) {
      dedupeMap.set(`err:${sku}:${location}:${Math.random()}`, {
        sku,
        productName: product.name,
        productId: product.id,
        location: loc.name,
        locationId: loc.id,
        qty: 0,
        unitCost: null,
        status: "error",
        message: `Qty "${qtyRaw}" must be a positive whole number`,
      });
      continue;
    }

    let unitCost: number | null = null;
    if (unitCostRaw) {
      unitCost = parseFloat(unitCostRaw);
      if (isNaN(unitCost) || unitCost <= 0) {
        dedupeMap.set(`err:${sku}:${location}:${Math.random()}`, {
          sku,
          productName: product.name,
          productId: product.id,
          location: loc.name,
          locationId: loc.id,
          qty,
          unitCost: null,
          status: "error",
          message: `UnitCost "${unitCostRaw}" must be a positive number`,
        });
        continue;
      }
    }

    const key = `${product.id}:${loc.id}`;
    const isDuplicate = dedupeMap.has(key);
    dedupeMap.set(key, {
      sku,
      productName: product.name,
      productId: product.id,
      location: loc.name,
      locationId: loc.id,
      qty,
      unitCost,
      status: "ok",
      message: isDuplicate ? "Duplicate in file — this row overwrites the earlier one" : undefined,
    });
    if (isDuplicate) {
      dedupeMap.get(key)!.status = "warning";
    }
  }

  const validated = Array.from(dedupeMap.values());

  // Check existing stock (warn, not block) — only needed for validation preview
  if (!confirm) {
    const productIds = validated.filter((r) => r.productId && r.status !== "error").map((r) => r.productId!);
    if (productIds.length > 0) {
      const existingStock = await prisma.stock.findMany({
        where: { productId: { in: productIds }, quantity: { gt: 0 } },
        select: { productId: true, locationId: true, quantity: true },
      });
      const stockMap = new Map(existingStock.map((s) => [`${s.productId}:${s.locationId}`, s.quantity]));
      for (const row of validated) {
        if (row.status === "ok" && row.productId && row.locationId) {
          const existing = stockMap.get(`${row.productId}:${row.locationId}`);
          if (existing && existing > 0) {
            row.status = "warning";
            row.message = `Will overwrite existing stock of ${existing.toLocaleString()}`;
          }
        }
      }
    }
  }

  const hasErrors = validated.some((r) => r.status === "error");

  if (!confirm || hasErrors) {
    return NextResponse.json({ rows: validated, hasErrors });
  }

  // ── Import ────────────────────────────────────────────────────────────────
  const toImport = validated.filter((r) => r.productId && r.locationId);

  // Compute per-product weighted average cost across all rows in this import
  const productCostMap = new Map<string, { totalQty: number; totalCost: number }>();
  for (const row of toImport) {
    if (row.unitCost != null && row.productId) {
      const existing = productCostMap.get(row.productId) ?? { totalQty: 0, totalCost: 0 };
      productCostMap.set(row.productId, {
        totalQty: existing.totalQty + row.qty,
        totalCost: existing.totalCost + row.qty * row.unitCost,
      });
    }
  }

  // Single bulk upsert — one SQL round-trip regardless of row count.
  // crypto.randomUUID() generates IDs for new rows; ON CONFLICT ignores id for existing rows.
  await prisma.$executeRaw`
    INSERT INTO "Stock" (id, "productId", "locationId", quantity, "updatedAt")
    VALUES ${Prisma.join(
      toImport.map((r) =>
        Prisma.sql`(${crypto.randomUUID()}, ${r.productId!}, ${r.locationId!}, ${r.qty}, NOW())`
      )
    )}
    ON CONFLICT ("productId", "locationId") DO UPDATE
      SET quantity = EXCLUDED.quantity, "updatedAt" = NOW()
  `;

  // Update product costs in parallel (one update per distinct product)
  if (productCostMap.size > 0) {
    await Promise.all(
      Array.from(productCostMap).map(([productId, { totalQty, totalCost }]) => {
        const avgCost = totalCost / totalQty;
        return prisma.product.update({
          where: { id: productId },
          data: { lastCost: avgCost, avgCost },
        });
      })
    );
  }

  writeAuditLog({
    session,
    action: "IMPORT_OPENING_STOCK",
    description: `Imported opening stock: ${toImport.length} line(s) across ${new Set(toImport.map((r) => r.locationId)).size} location(s)`,
  });

  return NextResponse.json({ rows: validated, hasErrors: false, imported: toImport.length });
}
