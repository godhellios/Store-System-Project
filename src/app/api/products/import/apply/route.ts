import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { generateBaseBarcode, reserveUnitBarcodes } from "@/lib/barcode";
import type { ClassifiedRow, ParsedUnitConversion } from "../preview/route";
import { applyCostPostPass, type CostPostPassRow } from "@/lib/opening-cost";

export const maxDuration = 60;

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

  // ── Load existing products to make import idempotent ─────────────────────
  // If the user clicks "Confirm & Import" more than once, products already
  // created on a previous attempt are skipped rather than duplicated.
  const existingProducts = await prisma.product.findMany({
    select: { id: true, name: true, sku: true },
  });
  const existingSkuSet = new Set(existingProducts.map((p) => p.sku.toLowerCase()));
  const existingNameSet = new Set(existingProducts.map((p) => p.name.trim().toLowerCase()));
  // ─────────────────────────────────────────────────────────────────────────

  // ── Pre-generate all SKUs in bulk ─────────────────────────────────────────
  const rowsNeedingSku = rows.filter((r) => {
    if (r.blocked || r.action === "invalid" || r.action === "file_duplicate") return false;
    if (r.action === "update" || r.action === "link") return false;
    if (r.action === "create" && !r.raw.sku?.trim()) return true;
    if (r.action === "conflict" && (decisions[r.index] ?? "skip") === "create" && !r.raw.sku?.trim()) return true;
    return false;
  });

  const needyCategoryIds = [...new Set(rowsNeedingSku.map((r) => r.categoryId!).filter(Boolean))];
  const categoryData = await prisma.category.findMany({
    where: { id: { in: needyCategoryIds } },
    select: { id: true, code: true, name: true },
  });
  const catCodeMap = new Map(categoryData.map((c) => [c.id, c]));

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

  // ── Separate rows by action type ─────────────────────────────────────────
  type CreatePayload = {
    index: number;
    action: string;
    data: Prisma.ProductCreateManyInput;
    unitConversions: ParsedUnitConversion[];
    sku: string;
  };

  const toCreate: CreatePayload[] = [];
  const toUpdate: ClassifiedRow[] = [];
  const toSkip: ClassifiedRow[] = [];

  for (const row of rows) {
    const { index, action, blocked, raw, categoryId, unitId } = row;

    if (action === "invalid" || action === "file_duplicate" || blocked) {
      toSkip.push(row);
      continue;
    }

    if (action === "update" || action === "link") {
      toUpdate.push(row);
      continue;
    }

    if (action === "create" || (action === "conflict" && (decisions[index] ?? "skip") === "create")) {
      const sku = raw.sku?.trim() || preAssignedSkus.get(index);
      if (!sku) {
        const catName = catCodeMap.get(categoryId!)?.name ?? categoryId;
        results.push({ index, action, status: "error", message: `Category '${catName}' has no code set` });
        continue;
      }

      // Skip if already created by a previous import attempt
      if (existingSkuSet.has(sku.toLowerCase()) || existingNameSet.has(raw.name!.trim().toLowerCase())) {
        results.push({ index, action, status: "skipped", message: "Already exists — skipped to avoid duplicate" });
        continue;
      }

      const barcode = raw.barcode?.trim() || generateBaseBarcode(sku);
      toCreate.push({
        index,
        action: action === "conflict" ? "created (conflict resolved)" : action,
        sku,
        unitConversions: row.parsedUnitConversions ?? [],
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
    } else if (action === "conflict" && (decisions[index] ?? "skip") === "skip") {
      results.push({ index, action, status: "skipped", message: "Skipped by user" });
    }
  }

  // Skipped rows
  for (const row of toSkip) {
    results.push({ index: row.index, action: row.action, status: "skipped", message: row.issues[0] });
  }

  // ── Bulk create all new products in one DB call ───────────────────────────
  if (toCreate.length > 0) {
    try {
      const created = await prisma.product.createManyAndReturn({
        data: toCreate.map((r) => r.data),
        skipDuplicates: false,
      });

      // Map created products back to rows by SKU
      const createdBySku = new Map(created.map((p) => [p.sku, p.id]));

      // Bulk create unit conversions
      const allUnitConvData: Prisma.ProductUnitConversionCreateManyInput[] = [];
      for (const row of toCreate) {
        const productId = createdBySku.get(row.sku);
        if (!productId) continue;
        results.push({ index: row.index, action: row.action, status: "ok", productId });

        const needsBarcode = row.unitConversions.filter((uc) => !uc.barcode).length;
        const reserved = await reserveUnitBarcodes(needsBarcode, prisma);
        let ri = 0;
        for (const uc of row.unitConversions) {
          const barcode = uc.barcode || reserved[ri++];
          allUnitConvData.push({ productId, name: uc.name, conversionFactor: uc.conversionFactor, barcode });
        }
      }
      if (allUnitConvData.length > 0) {
        await prisma.productUnitConversion.createMany({ data: allUnitConvData });
      }
    } catch (err: unknown) {
      // Bulk insert failed — fall back to individual creates to identify bad rows
      for (const row of toCreate) {
        try {
          const product = await prisma.product.create({ data: row.data });
          if (row.unitConversions.length) {
            const needsBarcode = row.unitConversions.filter((uc) => !uc.barcode).length;
            const reserved = await reserveUnitBarcodes(needsBarcode, prisma);
            let ri = 0;
            await prisma.productUnitConversion.createMany({
              data: row.unitConversions.map((uc) => {
                const barcode = uc.barcode || reserved[ri++];
                return { productId: product.id, name: uc.name, conversionFactor: uc.conversionFactor, barcode };
              }),
            });
          }
          results.push({ index: row.index, action: row.action, status: "ok", productId: product.id });
        } catch (rowErr: unknown) {
          const msg = rowErr instanceof Error ? rowErr.message : "Unknown error";
          results.push({ index: row.index, action: row.action, status: "error", message: msg });
        }
      }
      void err;
    }
  }

  // ── Batch-fetch full product details for smart diffing ───────────────────
  const updateProductIds = toUpdate.map((r) => r.existingProduct!.id);
  const existingFullProducts = updateProductIds.length > 0
    ? await prisma.product.findMany({
        where: { id: { in: updateProductIds } },
        include: { unitConversions: true },
      })
    : [];
  const existingFullMap = new Map(existingFullProducts.map((p) => [p.id, p]));
  // ─────────────────────────────────────────────────────────────────────────

  // ── Individual updates/links ──────────────────────────────────────────────
  for (const row of toUpdate) {
    const { index, action, raw, categoryId, unitId, existingProduct } = row;
    try {
      const existing = existingFullMap.get(existingProduct!.id);

      // Build changes — only fields that actually differ from existing values
      const changes: Record<string, unknown> = {};
      if (raw.name?.trim() && raw.name.trim() !== existing?.name) changes.name = raw.name.trim();
      if (categoryId && categoryId !== existing?.categoryId) changes.categoryId = categoryId;
      if (unitId && unitId !== existing?.unitId) changes.unitId = unitId;
      if (raw.reorderPoint !== undefined) {
        const newVal = parseInt(raw.reorderPoint) || 0;
        if (newVal !== (existing?.reorderPoint ?? 0)) changes.reorderPoint = newVal;
      }
      if (raw.colorVariant !== undefined) {
        const newVal = raw.colorVariant.trim() || null;
        if (newVal !== (existing?.colorVariant ?? null)) changes.colorVariant = newVal;
      }
      if (raw.description !== undefined) {
        const newVal = raw.description.trim() || null;
        if (newVal !== (existing?.description ?? null)) changes.description = newVal;
      }
      if (raw.imageUrl !== undefined) {
        const newVal = raw.imageUrl.trim() || null;
        if (newVal !== (existing?.imageUrl ?? null)) changes.imageUrl = newVal;
      }

      // Smart unit conversion diff — only when import has a non-empty packing units list.
      // Empty packagingUnits in import = "no change to packing units" (safe default).
      const importUCs = row.parsedUnitConversions ?? [];
      const existingUCs = existing?.unitConversions ?? [];
      const toAddUCs = importUCs.filter((iuc) =>
        !existingUCs.some(
          (euc) =>
            euc.name.toLowerCase() === iuc.name.trim().toLowerCase() &&
            euc.conversionFactor === iuc.conversionFactor
        )
      );
      const toDeleteUCIds = importUCs.length > 0
        ? existingUCs
            .filter(
              (euc) =>
                !importUCs.some(
                  (iuc) =>
                    iuc.name.trim().toLowerCase() === euc.name.toLowerCase() &&
                    iuc.conversionFactor === euc.conversionFactor
                )
            )
            .map((euc) => euc.id)
        : [];
      const ucChanged = toAddUCs.length > 0 || toDeleteUCIds.length > 0;

      // Nothing changed at all — skip to preserve barcodes and avoid noise
      if (Object.keys(changes).length === 0 && !ucChanged) {
        results.push({ index, action: "no changes", status: "skipped", message: "No changes detected — skipped" });
        continue;
      }

      if (!isAdmin) {
        if (Object.keys(changes).length === 0) {
          results.push({ index, action: "no changes", status: "skipped", message: "No changes detected — skipped" });
          continue;
        }
        const product = await prisma.product.update({
          where: { id: existingProduct!.id },
          data: { pendingChanges: changes as Prisma.InputJsonValue, pendingChangedBy: submitterName, pendingChangedAt: new Date() },
        });
        results.push({ index, action: action + " (pending)", status: "ok", productId: product.id });
      } else {
        if (Object.keys(changes).length > 0) {
          await prisma.product.update({ where: { id: existingProduct!.id }, data: changes });
        }
        if (toDeleteUCIds.length > 0) {
          await prisma.productUnitConversion.deleteMany({ where: { id: { in: toDeleteUCIds } } });
        }
        if (toAddUCs.length > 0) {
          const needsBarcode = toAddUCs.filter((uc) => !uc.barcode).length;
          const reserved = await reserveUnitBarcodes(needsBarcode, prisma);
          let ri = 0;
          await prisma.productUnitConversion.createMany({
            data: toAddUCs.map((uc) => {
              const barcode = uc.barcode || reserved[ri++];
              return { productId: existingProduct!.id, name: uc.name, conversionFactor: uc.conversionFactor, barcode };
            }),
          });
        }
        results.push({ index, action, status: "ok", productId: existingProduct!.id });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      results.push({ index, action, status: "error", message: msg });
    }
  }

  // ── Cost post-pass (admin only) ───────────────────────────────────────────
  let costsUpdated = 0;
  if (isAdmin) {
    const costRows: CostPostPassRow[] = [];
    for (const row of rows) {
      const openingCostVal = parseFloat(row.raw.openingCost ?? "");
      const correctCostVal = parseFloat(row.raw.correctCost ?? "");
      if (!(openingCostVal > 0) && !(correctCostVal > 0)) continue;
      if (row.blocked || row.action === "invalid" || row.action === "file_duplicate") continue;
      if (row.action === "conflict" && (decisions[row.index] ?? "skip") === "skip") continue;

      let productId: string | undefined;
      if (row.action === "update" || row.action === "link") {
        productId = row.existingProduct?.id ?? undefined;
      } else {
        productId = results.find((r) => r.index === row.index && r.status === "ok")?.productId;
      }

      if (productId) {
        costRows.push({
          productId,
          openingCost: openingCostVal > 0 ? openingCostVal : undefined,
          correctCost: correctCostVal > 0 ? correctCostVal : undefined,
        });
      }
    }
    if (costRows.length > 0) {
      costsUpdated = await prisma.$transaction((tx) => applyCostPostPass(tx, costRows));
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  const ok = results.filter((r) => r.status === "ok").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const errors = results.filter((r) => r.status === "error").length;
  return NextResponse.json({ results, ok, skipped, errors, costsUpdated });
}
