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

  if (report === "receiving") {
    const isAdmin = session.user.role === "ADMIN";
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
    const toDate = to ? new Date(to + "T23:59:59") : new Date();

    const orders = await prisma.order.findMany({
      where: {
        type: "GRN",
        grnStatus: "APPROVED",
        createdAt: { gte: fromDate, lte: toDate },
        ...(locationId ? { toLocationId: locationId } : {}),
      },
      include: {
        supplierRef: true,
        toLocation: true,
        lines: {
          include: {
            product: { include: { category: true, unit: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Build per-supplier and per-category summaries
    const bySupplier: Record<string, { name: string; grns: number; units: number; value: number }> = {};
    const byCategory: Record<string, { name: string; grns: Set<string>; units: number; value: number }> = {};
    let totalGrns = orders.length;
    let totalUnits = 0;
    let totalValue = 0;

    for (const order of orders) {
      const supplierName = order.supplierRef?.name ?? order.supplier ?? "Unknown";
      if (!bySupplier[supplierName]) bySupplier[supplierName] = { name: supplierName, grns: 0, units: 0, value: 0 };
      bySupplier[supplierName].grns++;

      for (const line of order.lines) {
        const cost = isAdmin && line.unitCost != null ? Number(line.unitCost) * line.quantity : 0;
        bySupplier[supplierName].units += line.quantity;
        if (isAdmin) bySupplier[supplierName].value += cost;
        totalUnits += line.quantity;
        if (isAdmin) totalValue += cost;

        const catName = line.product.category.name;
        if (!byCategory[catName]) byCategory[catName] = { name: catName, grns: new Set(), units: 0, value: 0 };
        byCategory[catName].grns.add(order.id);
        byCategory[catName].units += line.quantity;
        if (isAdmin) byCategory[catName].value += cost;
      }
    }

    return NextResponse.json({
      overview: { totalGrns, totalUnits, totalValue: isAdmin ? totalValue : null },
      bySupplier: Object.values(bySupplier).sort((a, b) => b.units - a.units),
      byCategory: Object.values(byCategory).map((c) => ({ ...c, grns: c.grns.size })).sort((a, b) => b.units - a.units),
      orders: orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        createdAt: o.createdAt,
        supplier: o.supplierRef?.name ?? o.supplier ?? null,
        location: o.toLocation?.name ?? null,
        itemCount: o.lines.length,
        totalUnits: o.lines.reduce((s, l) => s + l.quantity, 0),
        totalValue: isAdmin ? o.lines.reduce((s, l) => s + (l.unitCost != null ? Number(l.unitCost) * l.quantity : 0), 0) : null,
      })),
    });
  }

  return NextResponse.json({ error: "Unknown report" }, { status: 400 });
}
