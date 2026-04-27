import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ExcelJS from "exceljs";

export type ImportValidationError = { rowNum: number; message: string };
export type ImportPreviewRow = {
  rowNum: number;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  currentStock: number;
  physicalQty: number;
  difference: number;
  notes: string;
};
export type ImportValidationResult = {
  errors: ImportValidationError[];
  rows: ImportPreviewRow[];
  locationName: string;
  skippedRows: number;
};

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "result" in v) return String((v as ExcelJS.CellFormulaValue).result ?? "").trim();
  return String(v).trim();
}

function cellNumber(cell: ExcelJS.Cell): number | null {
  const v = cell.value;
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object" && "result" in v) {
    const n = Number((v as ExcelJS.CellFormulaValue).result);
    return isNaN(n) ? null : n;
  }
  const n = Number(v);
  return isNaN(n) ? null : n;
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const locationId = formData.get("locationId") as string | null;

  if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (!locationId) return NextResponse.json({ error: "Location is required" }, { status: 400 });

  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) return NextResponse.json({ error: "Location not found" }, { status: 404 });

  // Parse Excel
  const arrayBuffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(arrayBuffer as any);
  } catch {
    return NextResponse.json({ error: "Invalid Excel file. Please upload a .xlsx file." }, { status: 400 });
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) return NextResponse.json({ error: "Excel file has no worksheets" }, { status: 400 });

  // Build product lookup maps
  const allProducts = await prisma.product.findMany({
    where: { isActive: true },
    include: { unit: true },
  });
  const byId = new Map(allProducts.map((p) => [p.id, p]));
  const bySku = new Map(allProducts.map((p) => [p.sku.toLowerCase(), p]));
  const byBarcode = new Map(
    allProducts.filter((p) => p.barcode).map((p) => [p.barcode!, p])
  );

  // Build current stock map for this location
  const stockRecords = await prisma.stock.findMany({
    where: { locationId },
  });
  const stockMap = new Map(stockRecords.map((s) => [s.productId, s.quantity]));

  const errors: ImportValidationError[] = [];
  const rows: ImportPreviewRow[] = [];
  const seenProductIds = new Set<string>();
  let skippedRows = 0;

  for (let rowNum = 2; rowNum <= sheet.rowCount; rowNum++) {
    const row = sheet.getRow(rowNum);

    // Skip fully empty rows
    const productIdRaw = cellText(row.getCell(1));
    const skuRaw = cellText(row.getCell(2));
    const barcodeRaw = cellText(row.getCell(3));
    const rawQty = row.getCell(9);
    const notes = cellText(row.getCell(10));

    // Skip if all identifier cells are empty
    if (!productIdRaw && !skuRaw && !barcodeRaw) continue;

    // Skip rows without a physical count (not counted)
    const physicalQty = cellNumber(rawQty);
    if (physicalQty === null) {
      skippedRows++;
      continue;
    }

    // Validate quantity
    if (physicalQty < 0) {
      errors.push({ rowNum, message: `Row ${rowNum}: Physical Count Qty cannot be negative (got ${physicalQty})` });
      continue;
    }
    if (!Number.isInteger(physicalQty)) {
      errors.push({ rowNum, message: `Row ${rowNum}: Physical Count Qty must be a whole number (got ${physicalQty})` });
      continue;
    }

    // Match product
    let product = byId.get(productIdRaw) ??
      bySku.get(skuRaw.toLowerCase()) ??
      byBarcode.get(barcodeRaw) ??
      null;

    if (!product) {
      errors.push({
        rowNum,
        message: `Row ${rowNum}: Product not found — ID: "${productIdRaw}", SKU: "${skuRaw}", Barcode: "${barcodeRaw}"`,
      });
      continue;
    }

    // Check for duplicates
    if (seenProductIds.has(product.id)) {
      errors.push({
        rowNum,
        message: `Row ${rowNum}: Duplicate product "${product.name}" (${product.sku}) — appears more than once`,
      });
      continue;
    }
    seenProductIds.add(product.id);

    const currentStock = stockMap.get(product.id) ?? 0;
    rows.push({
      rowNum,
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      unit: product.unit.name,
      currentStock,
      physicalQty,
      difference: physicalQty - currentStock,
      notes,
    });
  }

  const result: ImportValidationResult = {
    errors,
    rows,
    locationName: location.name,
    skippedRows,
  };

  return NextResponse.json(result);
}
