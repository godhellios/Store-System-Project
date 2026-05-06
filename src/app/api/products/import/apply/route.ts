import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateSku } from "@/lib/sku";
import { generateBaseBarcode, generateUnitBarcode } from "@/lib/barcode";
import type { ClassifiedRow, ParsedUnitConversion } from "../preview/route";

type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function upsertUnitConversions(productId: string, sku: string, units: ParsedUnitConversion[], tx: TransactionClient) {
  if (!units.length) return;
  await tx.productUnitConversion.deleteMany({ where: { productId } });
  for (const uc of units) {
    const barcode = uc.barcode ||
      generateUnitBarcode(sku, uc.name.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5));
    await tx.productUnitConversion.create({
      data: { productId, name: uc.name, conversionFactor: uc.conversionFactor, barcode },
    });
  }
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

  const results: ApplyResult[] = [];

  for (const row of rows) {
    const { index, action, blocked, raw, categoryId, unitId, existingProduct } = row;

    if (action === "invalid" || action === "file_duplicate" || blocked) {
      results.push({ index, action, status: "skipped", message: row.issues[0] });
      continue;
    }

    try {
      if (action === "create") {
        const product = await prisma.$transaction(async (tx) => {
          // Use explicit SKU from file if provided; otherwise auto-generate
          const sku = raw.sku?.trim() || await generateSku(categoryId!, tx);
          const barcode = raw.barcode?.trim() || generateBaseBarcode(sku);
          const p = await tx.product.create({
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
          await upsertUnitConversions(p.id, sku, row.parsedUnitConversions ?? [], tx);
          return p;
        });
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
        if (row.parsedUnitConversions?.length) changes.unitConversions = row.parsedUnitConversions;

        if (!isAdmin) {
          // Store as pending edit — requires admin approval
          const product = await prisma.product.update({
            where: { id: existingProduct!.id },
            data: { pendingChanges: changes, pendingChangedBy: submitterName, pendingChangedAt: new Date() },
          });
          results.push({ index, action: action + " (pending)", status: "ok", productId: product.id });
        } else {
          const { unitConversions: _, ...directData } = changes;
          const product = await prisma.$transaction(async (tx) => {
            const p = await tx.product.update({ where: { id: existingProduct!.id }, data: directData });
            if (row.parsedUnitConversions?.length) {
              await upsertUnitConversions(p.id, p.sku, row.parsedUnitConversions, tx);
            }
            return p;
          });
          results.push({ index, action, status: "ok", productId: product.id });
        }

      } else if (action === "conflict") {
        const decision = decisions[index] ?? "skip";
        if (decision === "skip") {
          results.push({ index, action, status: "skipped", message: "Skipped by user" });
        } else {
          const product = await prisma.$transaction(async (tx) => {
            const sku = raw.sku?.trim() || await generateSku(categoryId!, tx);
            const barcode = raw.barcode?.trim() || generateBaseBarcode(sku);
            const p = await tx.product.create({
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
            await upsertUnitConversions(p.id, sku, row.parsedUnitConversions ?? [], tx);
            return p;
          });
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
