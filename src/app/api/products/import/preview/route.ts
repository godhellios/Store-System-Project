import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type RawRow = {
  name?: string; sku?: string; barcode?: string;
  category?: string; unit?: string;
  reorderPoint?: string; colorVariant?: string; description?: string;
};

export type RowAction = "create" | "update" | "link" | "conflict" | "file_duplicate" | "invalid";

export type ClassifiedRow = {
  index: number;
  raw: RawRow;
  normalizedSku: string;
  normalizedName: string;
  action: RowAction;
  blocked: boolean; // cannot be processed even after confirmation
  existingProduct: { id: string; name: string; sku: string } | null;
  categoryId: string | null;
  unitId: string | null;
  issues: string[];
};

export type PreviewSummary = {
  total: number;
  create: number;
  update: number;
  link: number;
  conflict: number;
  fileDuplicate: number;
  invalid: number;
  blocked: number;
};

function normSku(s: string) { return s.trim().toLowerCase(); }
function normName(s: string) { return s.trim().replace(/\s+/g, " ").toLowerCase(); }

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const rows: RawRow[] = body.rows ?? [];
  if (!Array.isArray(rows) || rows.length === 0)
    return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const [existingProducts, categories, units] = await Promise.all([
    prisma.product.findMany({ select: { id: true, name: true, sku: true } }),
    prisma.category.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    prisma.unit.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
  ]);

  const skuMap = new Map(existingProducts.map((p) => [normSku(p.sku), p]));
  const nameMap = new Map(existingProducts.map((p) => [normName(p.name), p]));
  const catMap = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c]));
  const unitMap = new Map(units.map((u) => [u.name.trim().toLowerCase(), u]));

  // Build file-level duplicate maps
  const fileSkuIdx = new Map<string, number[]>();
  const fileNameIdx = new Map<string, number[]>();
  rows.forEach((row, i) => {
    const ns = row.sku?.trim() ? normSku(row.sku) : "";
    const nn = row.name?.trim() ? normName(row.name) : "";
    if (ns) { if (!fileSkuIdx.has(ns)) fileSkuIdx.set(ns, []); fileSkuIdx.get(ns)!.push(i); }
    if (nn) { if (!fileNameIdx.has(nn)) fileNameIdx.set(nn, []); fileNameIdx.get(nn)!.push(i); }
  });

  const classified: ClassifiedRow[] = rows.map((row, i) => {
    const ns = row.sku?.trim() ? normSku(row.sku) : "";
    const nn = row.name?.trim() ? normName(row.name) : "";
    const issues: string[] = [];

    const cat = row.category?.trim() ? catMap.get(row.category.trim().toLowerCase()) : undefined;
    const unit = row.unit?.trim() ? unitMap.get(row.unit.trim().toLowerCase()) : undefined;
    const categoryId = cat?.id ?? null;
    const unitId = unit?.id ?? null;
    if (row.category?.trim() && !cat) issues.push(`Category "${row.category}" not found`);
    if (row.unit?.trim() && !unit) issues.push(`Unit "${row.unit}" not found`);

    const base = { index: i, raw: row, normalizedSku: ns, normalizedName: nn, categoryId, unitId };

    // Both empty → invalid
    if (!ns && !nn) {
      return { ...base, action: "invalid" as RowAction, blocked: true, existingProduct: null,
        issues: [...issues, "SKU and Item Name are empty. This row cannot be imported."] };
    }

    // File duplicate
    const fileDupSku = ns && (fileSkuIdx.get(ns)?.length ?? 0) > 1;
    const fileDupName = nn && (fileNameIdx.get(nn)?.length ?? 0) > 1;
    if (fileDupSku || fileDupName) {
      return { ...base, action: "file_duplicate" as RowAction, blocked: true, existingProduct: null,
        issues: [...issues, "Duplicate item found inside uploaded file. Please review this row."] };
    }

    const skuMatch = ns ? skuMap.get(ns) ?? null : null;
    const nameMatch = nn ? nameMap.get(nn) ?? null : null;

    // SKU matches existing → update
    if (skuMatch) {
      return { ...base, action: "update" as RowAction, blocked: false, existingProduct: skuMatch,
        issues: [...issues, "SKU already exists. This row will be linked to the existing item."] };
    }

    // No SKU, name matches → link
    if (!ns && nameMatch) {
      return { ...base, action: "link" as RowAction, blocked: false, existingProduct: nameMatch,
        issues: [...issues, "SKU is empty and item name already exists. This row will be linked to the existing item."] };
    }

    // Name matches but different SKU → conflict
    if (nameMatch) {
      return { ...base, action: "conflict" as RowAction, blocked: false, existingProduct: nameMatch,
        issues: [...issues, "Item name already exists with a different SKU. Please review before creating a new item."] };
    }

    // New item
    const createIssues = [...issues];
    if (!nn) createIssues.push("Item Name is required to create a new item.");
    if (!categoryId) createIssues.push("Valid Category is required to create a new item.");
    if (!unitId) createIssues.push("Valid Unit is required to create a new item.");
    const blocked = !nn || !categoryId || !unitId;
    return { ...base, action: "create" as RowAction, blocked, existingProduct: null, issues: createIssues };
  });

  const summary: PreviewSummary = {
    total: classified.length,
    create: classified.filter((r) => r.action === "create" && !r.blocked).length,
    update: classified.filter((r) => r.action === "update").length,
    link: classified.filter((r) => r.action === "link").length,
    conflict: classified.filter((r) => r.action === "conflict").length,
    fileDuplicate: classified.filter((r) => r.action === "file_duplicate").length,
    invalid: classified.filter((r) => r.action === "invalid").length,
    blocked: classified.filter((r) => r.blocked).length,
  };

  return NextResponse.json({ classified, summary });
}
