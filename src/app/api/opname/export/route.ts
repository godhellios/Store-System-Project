import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ExcelJS from "exceljs";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const locationId = searchParams.get("locationId") ?? undefined;

  const [products, location] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true },
      include: { category: true, unit: true },
      orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
    }),
    locationId ? prisma.location.findUnique({ where: { id: locationId } }) : null,
  ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MRIS";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Stock Opname");

  sheet.columns = [
    { header: "Product ID", key: "productId", width: 30 },
    { header: "SKU", key: "sku", width: 16 },
    { header: "Barcode", key: "barcode", width: 16 },
    { header: "Product Name", key: "name", width: 36 },
    { header: "Category", key: "category", width: 18 },
    { header: "Variant", key: "variant", width: 20 },
    { header: "Location", key: "location", width: 16 },
    { header: "Base Unit", key: "unit", width: 12 },
    { header: "Physical Count Qty", key: "physicalQty", width: 20 },
    { header: "Notes", key: "notes", width: 28 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: false };
    cell.border = {
      top: { style: "thin", color: { argb: "FF1E3A5F" } },
      bottom: { style: "thin", color: { argb: "FF1E3A5F" } },
      left: { style: "thin", color: { argb: "FF1E3A5F" } },
      right: { style: "thin", color: { argb: "FF1E3A5F" } },
    };
  });
  headerRow.height = 26;

  for (const product of products) {
    const row = sheet.addRow({
      productId: product.id,
      sku: product.sku,
      barcode: product.barcode ?? "",
      name: product.name,
      category: product.category.name,
      variant: product.colorVariant ?? "",
      location: location?.name ?? "",
      unit: product.unit.name,
      physicalQty: null,
      notes: "",
    });

    // Lock identifier columns so staff don't accidentally edit them
    const idCols = [1, 2, 3, 4, 5, 6, 7, 8];
    idCols.forEach((c) => {
      const cell = row.getCell(c);
      cell.font = { size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8F9FA" } };
    });

    // Highlight Physical Count Qty column in yellow (fill-in area)
    const qtyCell = row.getCell(9);
    qtyCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF9C4" } };
    qtyCell.alignment = { horizontal: "center" };

    // Light blue tint for notes
    row.getCell(10).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F4FD" } };

    row.height = 18;
  }

  // Add a legend row at the bottom
  const legendRow = sheet.addRow([
    "← Do not edit columns A–H. Fill in column I with physical counted quantities.",
  ]);
  legendRow.getCell(1).font = { italic: true, color: { argb: "FF888888" }, size: 9 };
  sheet.mergeCells(`A${legendRow.number}:J${legendRow.number}`);

  sheet.views = [{ state: "frozen", ySplit: 1, xSplit: 0 }];

  // Add data validation: physicalQty must be a non-negative integer
  sheet.getColumn(9).eachCell({ includeEmpty: false }, (cell, rowNum) => {
    if (rowNum === 1) return;
    cell.dataValidation = {
      type: "whole",
      operator: "greaterThanOrEqual",
      showErrorMessage: true,
      formulae: [0],
      errorStyle: "stop",
      errorTitle: "Invalid Quantity",
      error: "Physical Count Qty must be a whole number ≥ 0",
    };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const locationName = location?.name.replace(/\s+/g, "_") ?? "AllLocations";
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `StockOpname_${locationName}_${dateStr}.xlsx`;

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
