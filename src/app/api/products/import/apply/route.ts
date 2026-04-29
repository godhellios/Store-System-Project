import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { ClassifiedRow } from "../preview/route";

function genBarcode() {
  return "MR" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
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

  const body = await req.json();
  const rows: ClassifiedRow[] = body.rows ?? [];
  // conflictDecisions: { [index]: "create" | "skip" }
  const decisions: Record<number, "create" | "skip"> = body.conflictDecisions ?? {};

  const results: ApplyResult[] = [];

  for (const row of rows) {
    const { index, action, blocked, raw, categoryId, unitId, existingProduct } = row;

    // Always skip these
    if (action === "invalid" || action === "file_duplicate" || blocked) {
      results.push({ index, action, status: "skipped", message: row.issues[0] });
      continue;
    }

    try {
      if (action === "create") {
        const barcode = raw.barcode?.trim() || genBarcode();
        const product = await prisma.product.create({
          data: {
            name: raw.name!.trim(),
            sku: raw.sku?.trim() || ("SKU-" + Date.now().toString(36).slice(-6).toUpperCase()),
            barcode,
            categoryId: categoryId!,
            unitId: unitId!,
            reorderPoint: parseInt(raw.reorderPoint ?? "0") || 0,
            colorVariant: raw.colorVariant?.trim() || null,
            description: raw.description?.trim() || null,
          },
        });
        results.push({ index, action, status: "ok", productId: product.id });

      } else if (action === "update" || action === "link") {
        const data: Record<string, unknown> = {};
        if (raw.name?.trim()) data.name = raw.name.trim();
        if (categoryId) data.categoryId = categoryId;
        if (unitId) data.unitId = unitId;
        if (raw.reorderPoint !== undefined) data.reorderPoint = parseInt(raw.reorderPoint) || 0;
        if (raw.colorVariant !== undefined) data.colorVariant = raw.colorVariant.trim() || null;
        if (raw.description !== undefined) data.description = raw.description.trim() || null;
        const product = await prisma.product.update({ where: { id: existingProduct!.id }, data });
        results.push({ index, action, status: "ok", productId: product.id });

      } else if (action === "conflict") {
        const decision = decisions[index] ?? "skip";
        if (decision === "skip") {
          results.push({ index, action, status: "skipped", message: "Skipped by user" });
        } else {
          // User chose to create as new
          const barcode = raw.barcode?.trim() || genBarcode();
          const skuBase = raw.sku?.trim() || ("SKU-" + Date.now().toString(36).slice(-6).toUpperCase());
          const product = await prisma.product.create({
            data: {
              name: raw.name!.trim(),
              sku: skuBase,
              barcode,
              categoryId: categoryId!,
              unitId: unitId!,
              reorderPoint: parseInt(raw.reorderPoint ?? "0") || 0,
              colorVariant: raw.colorVariant?.trim() || null,
              description: raw.description?.trim() || null,
            },
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
