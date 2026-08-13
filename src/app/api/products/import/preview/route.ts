import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isEligiblePackingUnit, type MasterUnit } from "@/lib/packing-units";

export type RawRow = {
  name?: string; sku?: string; barcode?: string;
  category?: string; unit?: string;
  reorderPoint?: string; colorVariant?: string; description?: string;
  // Format: "Box:12|Crate:144" or "Box:12:BARCODE|Crate:144:BARCODE"
  packagingUnits?: string;
  imageUrl?: string; // BULK_IMAGE_UPLOAD
  openingCost?: string; // Sets avgCost only when currently NULL (admin-only post-pass)
  correctCost?: string; // Always overrides avgCost (admin-only post-pass)
};

export type RowAction = "create" | "update" | "link" | "conflict" | "file_duplicate" | "invalid";

export type ParsedUnitConversion = {
  unitId: string;
  unitName: string;
  barcode: string | null;
};

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
  parsedUnitConversions: ParsedUnitConversion[];
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

/**
 * Parse the packagingUnits cell into references to the Unit master.
 *
 * Accepted: "Box Of 500 Yard", "Box::BARCODE", and the legacy "Box:12" /
 * "Box:12:BARCODE". The factor is no longer imported — it lives on the Unit —
 * but a legacy value that disagrees with the master is reported so a stale
 * spreadsheet cannot silently mean something different from Settings.
 */
function parsePackagingUnits(
  raw: string | undefined,
  units: MasterUnit[],
  baseUnitId: string | null,
): { parsed: ParsedUnitConversion[]; errors: string[] } {
  if (!raw?.trim()) return { parsed: [], errors: [] };
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const byNorm = new Map(units.map((u) => [norm(u.name), u]));
  const errors: string[] = [];
  const parsed: ParsedUnitConversion[] = [];

  for (const part of raw.split("|")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [rawName, rawFactor, rawBarcode] = trimmed.split(":");
    const name = rawName?.trim();
    if (!name) {
      errors.push(`Invalid packaging unit "${trimmed}" — expected a unit name from Settings`);
      continue;
    }
    const unit = byNorm.get(norm(name));
    if (!unit) {
      errors.push(`Packing unit "${name}" does not exist in Settings › Units — create it there first`);
      continue;
    }
    if (!isEligiblePackingUnit(unit, baseUnitId)) {
      errors.push(`Packing unit "${unit.name}" is measured in a different unit than this product's base unit`);
      continue;
    }
    const legacyFactor = parseFloat(rawFactor ?? "");
    if (!isNaN(legacyFactor) && legacyFactor > 0 && legacyFactor !== unit.conversionFactor) {
      errors.push(
        `Packing unit "${unit.name}": the file says ${legacyFactor} but Settings says ${unit.conversionFactor}. Settings wins — fix the file or the unit.`,
      );
      continue;
    }
    parsed.push({ unitId: unit.id, unitName: unit.name, barcode: rawBarcode?.trim() || null });
  }
  return { parsed, errors };
}

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
    // parentUnitId + conversionFactor are needed to resolve packing units and
    // check they belong to the row's base unit.
    prisma.unit.findMany({
      where: { isActive: true },
      select: { id: true, name: true, isActive: true, parentUnitId: true, conversionFactor: true },
    }),
  ]);
  const allUnits: MasterUnit[] = units;

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

    const { parsed: parsedUnitConversions, errors: unitErrors } = parsePackagingUnits(row.packagingUnits, allUnits, unitId);
    if (unitErrors.length) issues.push(...unitErrors);

    const base = { index: i, raw: row, normalizedSku: ns, normalizedName: nn, categoryId, unitId, parsedUnitConversions };

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
