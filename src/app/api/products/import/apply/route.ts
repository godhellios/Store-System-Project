import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { generateBaseBarcode, generateUnitBarcode } from "@/lib/barcode";
import type { ClassifiedRow, ParsedUnitConversion } from "../preview/route";

export const maxDuration = 60;

async function createUnitConversions(productId: string, sku: string, units: ParsedUnitConversion[]) {
  if (!units.length) return;
  await prisma.productUnitConversion.createMany({
    data: units.map((uc) => {
      const barcode =
        uc.barcode ||
        generateUnitBarcode(sku, uc.name.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5));
      return { productId, name: uc.name, conversionFactor: uc.conversionFactor, barcode };
    }),
  });
}

export type ApplyResult = {
  index: number;
  action: string;
  status: "ok" | "skipped" | "error";
  message?: string;
  productId?: string;
};

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isAdmin = session.user.role === "ADMIN";
  const approvalStatus = isAdmin ? "ACTIVE" : "DRAFT";
  const submitterName = session.user.name ?? session.user.email ?? null;

  const body = await req.json();
  const rows: ClassifiedRow[] = body.rows ?? [];
  const decisions: Record<number, "create" | "skip"> = body.conflictDecisions ?? {};

  // ── Pre-generate all SKUs in bulk ─────────────────────────────────────────
  // Collect rows that need auto-generated SKUs (create or conflict-resolved-as-create, no explicit SKU)
  const rowsNeedingSku = rows.filter((r) => {
    if (r.blocked || r.action === "invalid" || r.action === "file_duplicate") return false;
    if (r.action === "update" || r.action === "link") return false;
    if (r.action === "create" && !r.raw.sku?.trim()) return true;
    if (r.action === "conflict" && (decisions[r.index] ?? "skip") === "create" && !r.raw.sku?.trim()) return true;
    return false;
  });

  const needyCategoryIds = [...new Set(rowsNeedingSku.map((r) => r.categoryId!).filter(Boolean))];

  // Fetch category codes in one query
  const categoryData = await prisma.category.findMany({
    where: { id: { in: needyCategoryIds } },
    select: { id: true, code: true, name: true },
  });
  const catCodeMap = new Map(categoryData.map((c) => [c.id, c]));

  // Find current max SKU per category prefix (parallel, one query per unique category)
  const skuCounters = new Map<string, number>();
  await Promise.all(
    categoryData.map(async (cat) => {
      if (!cat.code) return;
      const last = await prisma.product.findFirst({
        where: { sku: { startsWith: `${cat.code}-` } },
        orderBy: { sku: "desc" },
        select: { sku: true },
      });
      skuCounters.set(cat.code, last ? parseInt(last.sku.split("-").pop() ?? "0", 10) : 0);
    })
  );

  // Assign SKUs in order (sequential so each row gets a unique number)
  const preAssignedSkus = new Map<number, string>();
  for (const row of rowsNeedingSku) {
    const cat = catCodeMap.get(row.categoryId!);
    if (!cat?.code) continue;
    const current = skuCounters.get(cat.code) ?? 0;
    const next = current + 1;
    skuCounters.set(cat.code, next);
    preAssignedSkus.set(row.index, `${cat.code}-${String(next).padStart(5, "0")}`);
  }
  // ─────────────────────────────────────────────────────────────────────────

  const results: ApplyResult[] = [];

  for (const row of rows) {
    const { index, action, blocked, raw, categoryId, unitId, existingProduct } = row;

    if (action === "invalid" || action === "file_duplicate" || blocked) {
      results.push({ index, action, status: "skipped", message: row.issues[0] });
      continue;
    }

    try {
      if (action === "create") {
        const sku = raw.sku?.trim() || preAssignedSkus.get(index);
        if (!sku) {
          const catName = catCodeMap.get(categoryId!)?.name ?? categoryId;
          results.push({ index, action, status: "error", message: `Category '${catName}' has no code set — ask admin to set it in Settings` });
          continue;
        }
        const barcode = raw.barcode?.trim() || generateBaseBarcode(sku);
        const product = await prisma.product.create({
          data: {
            name: raw.name!.trim(),
            sku,
            barcode,
            categoryId: categoryId!,
            unitId: unitId!,
            reorderPoint: parseInt(raw.reorderPoint ?? "0") || 0,
            colorVariant: raw.colorVariant?.trim() || null,
            description: raw.description?.trim() || null,
            imageUrl: raw.imageUrl?.trim() || null,
            approvalStatus,
            ...(!isAdmin ? { pendingChangedBy: submitterName, pendingChangedAt: new Date() } : {}),
          },
        });
        await createUnitConversions(product.id, sku, row.parsedUnitConversions ?? []);
        results.push({ index, action, status: "ok", productId: product.id });

      } else if (action === "update" || action === "link") {
        const changes: Record<string, unknown> = {};
        if (raw.name?.trim()) changes.name = raw.name.trim();
        if (categoryId) changes.categoryId = categoryId;
        if (unitId) changes.unitId = unitId;
        if (raw.reorderPoint !== undefined) changes.reorderPoint = parseInt(raw.reorderPoint) || 0;
        if (raw.colorVariant !== undefined) changes.colorVariant = raw.colorVariant.trim() || null;
        if (raw.description !== undefined) changes.description = raw.description.trim() || null;
        if (raw.imageUrl !== undefined) changes.imageUrl = raw.imageUrl.trim() || null;

        if (!isAdmin) {
          const product = await prisma.product.update({
            where: { id: existingProduct!.id },
            data: { pendingChanges: changes as Prisma.InputJsonValue, pendingChangedBy: submitterName, pendingChangedAt: new Date() },
          });
          results.push({ index, action: action + " (pending)", status: "ok", productId: product.id });
        } else {
          const product = await prisma.product.update({ where: { id: existingProduct!.id }, data: changes });
          if (row.parsedUnitConversions?.length) {
            await prisma.productUnitConversion.deleteMany({ where: { productId: product.id } });
            await createUnitConversions(product.id, product.sku, row.parsedUnitConversions);
          }
          results.push({ index, action, status: "ok", productId: product.id });
        }

      } else if (action === "conflict") {
        const decision = decisions[index] ?? "skip";
        if (decision === "skip") {
          results.push({ index, action, status: "skipped", message: "Skipped by user" });
        } else {
          const sku = raw.sku?.trim() || preAssignedSkus.get(index);
          if (!sku) {
            const catName = catCodeMap.get(categoryId!)?.name ?? categoryId;
            results.push({ index, action, status: "error", message: `Category '${catName}' has no code set — ask admin to set it in Settings` });
            continue;
          }
          const barcode = raw.barcode?.trim() || generateBaseBarcode(sku);
          const product = await prisma.product.create({
            data: {
              name: raw.name!.trim(),
              sku,
              barcode,
              categoryId: categoryId!,
              unitId: unitId!,
              reorderPoint: parseInt(raw.reorderPoint ?? "0") || 0,
              colorVariant: raw.colorVariant?.trim() || null,
              description: raw.description?.trim() || null,
              approvalStatus,
              ...(!isAdmin ? { pendingChangedBy: submitterName, pendingChangedAt: new Date() } : {}),
            },
          });
          await createUnitConversions(product.id, sku, row.parsedUnitConversions ?? []);
          results.push({ index, action: "created (conflict resolved)", status: "ok", productId: product.id });
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      results.push({ index, action, status: "error", message: msg });
    }
  }

  const ok = results.filter((r) => r.status === "ok").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const errors = results.filter((r) => r.status === "error").length;
  return NextResponse.json({ results, ok, skipped, errors });
}
