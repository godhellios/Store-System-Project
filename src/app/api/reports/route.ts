import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ExcelJS from "exceljs";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const report = searchParams.get("report") ?? "stock";
  const format = searchParams.get("format") ?? "json";
  const locationId = searchParams.get("locationId") ?? "";
  const categoryId = searchParams.get("categoryId") ?? "";
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (report === "stock") {
    const stock = await prisma.stock.findMany({
      where: {
        product: { isActive: true, ...(categoryId ? { categoryId } : {}) },
        ...(locationId ? { locationId } : {}),
      },
      include: { product: { include: { category: true, unit: true } }, location: true },
      orderBy: [{ location: { name: "asc" } }, { product: { name: "asc" } }],
    });

    if (format === "xlsx") {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Stock On Hand");
      ws.columns = [
        { header: "Location", key: "location", width: 20 },
        { header: "Product", key: "product", width: 30 },
        { header: "SKU", key: "sku", width: 15 },
        { header: "Category", key: "category", width: 15 },
        { header: "Unit", key: "unit", width: 10 },
        { header: "Quantity", key: "qty", width: 12 },
        { header: "Reorder Point", key: "reorder", width: 14 },
      ];
      ws.getRow(1).font = { bold: true };
      stock.forEach((s) => {
        ws.addRow({
          location: s.location.name,
          product: s.product.name,
          sku: s.product.sku,
          category: s.product.category.name,
          unit: s.product.unit.name,
          qty: s.quantity,
          reorder: s.product.reorderPoint,
        });
      });
      const buf = await wb.xlsx.writeBuffer();
      return new NextResponse(buf, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="stock-on-hand-${Date.now()}.xlsx"`,
        },
      });
    }
    return NextResponse.json(stock);
  }

  if (report === "movements") {
    const movements = await prisma.movement.findMany({
      where: {
        ...(from || to ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to + "T23:59:59") } : {}) } } : {}),
        ...(locationId ? { OR: [{ fromLocationId: locationId }, { toLocationId: locationId }] } : {}),
        product: { ...(categoryId ? { categoryId } : {}) },
      },
      include: { product: { include: { unit: true } }, fromLocation: true, toLocation: true, order: true },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });

    if (format === "xlsx") {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Movements");
      ws.columns = [
        { header: "Date", key: "date", width: 18 },
        { header: "Order", key: "order", width: 16 },
        { header: "Type", key: "type", width: 12 },
        { header: "Product", key: "product", width: 30 },
        { header: "From", key: "from", width: 20 },
        { header: "To", key: "to", width: 20 },
        { header: "Qty", key: "qty", width: 10 },
        { header: "Unit", key: "unit", width: 10 },
      ];
      ws.getRow(1).font = { bold: true };
      movements.forEach((m) => {
        ws.addRow({
          date: m.createdAt.toISOString().replace("T", " ").slice(0, 16),
          order: m.order?.orderNumber ?? m.orderId,
          type: m.type,
          product: m.product.name,
          from: m.fromLocation?.name ?? "-",
          to: m.toLocation?.name ?? "-",
          qty: m.quantity,
          unit: m.product.unit.name,
        });
      });
      const buf = await wb.xlsx.writeBuffer();
      return new NextResponse(buf, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="movements-${Date.now()}.xlsx"`,
        },
      });
    }
    return NextResponse.json(movements);
  }

  if (report === "low-stock") {
    const stock = await prisma.stock.findMany({
      where: {
        product: { isActive: true, ...(categoryId ? { categoryId } : {}) },
        ...(locationId ? { locationId } : {}),
      },
      include: { product: { include: { category: true, unit: true } }, location: true },
    });
    const low = stock.filter((s) => s.product.reorderPoint > 0 && s.quantity <= s.product.reorderPoint);
    low.sort((a, b) => a.quantity - b.quantity);

    if (format === "xlsx") {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Low Stock");
      ws.columns = [
        { header: "Product", key: "product", width: 30 },
        { header: "Location", key: "location", width: 20 },
        { header: "Current Qty", key: "qty", width: 14 },
        { header: "Reorder Point", key: "reorder", width: 14 },
        { header: "Shortfall", key: "shortfall", width: 12 },
        { header: "Unit", key: "unit", width: 10 },
      ];
      ws.getRow(1).font = { bold: true };
      low.forEach((s) => {
        ws.addRow({
          product: s.product.name,
          location: s.location.name,
          qty: s.quantity,
          reorder: s.product.reorderPoint,
          shortfall: s.product.reorderPoint - s.quantity,
          unit: s.product.unit.name,
        });
      });
      const buf = await wb.xlsx.writeBuffer();
      return new NextResponse(buf, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="low-stock-${Date.now()}.xlsx"`,
        },
      });
    }
    return NextResponse.json(low);
  }

  return NextResponse.json({ error: "Unknown report" }, { status: 400 });
}
