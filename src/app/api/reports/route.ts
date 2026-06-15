import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeRestockSuggestions, type RestockInput } from "@/lib/restock";
import ExcelJS from "exceljs";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Reports are oversight-only: ADMIN + VIEWER. STAFF/OPERATOR are blocked.
  if (session.user.role !== "ADMIN" && session.user.role !== "VIEWER")
    return NextResponse.json({ error: "Reports are restricted to admins and viewers" }, { status: 403 });

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
    const isAdmin = session.user.role === "ADMIN" || session.user.role === "VIEWER";
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

  if (report === "inventory-value") {
    const isAdminOrViewer = session.user.role === "ADMIN" || session.user.role === "VIEWER";
    if (!isAdminOrViewer) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Current snapshot: qty × avgCost per stock record, grouped by location
    const stock = await prisma.stock.findMany({
      where: {
        product: { isActive: true, ...(categoryId ? { categoryId } : {}) },
        ...(locationId ? { locationId } : {}),
      },
      include: { product: { include: { category: true, unit: true } }, location: true },
    });

    const totalValue = stock.reduce((s, r) => s + (r.product.avgCost != null ? Number(r.product.avgCost) * r.quantity : 0), 0);
    const totalUnits = stock.reduce((s, r) => s + r.quantity, 0);
    const withCost = stock.filter((r) => r.product.avgCost != null);

    // By location
    const byLocation: Record<string, { name: string; units: number; value: number }> = {};
    for (const r of stock) {
      const loc = r.location.name;
      if (!byLocation[loc]) byLocation[loc] = { name: loc, units: 0, value: 0 };
      byLocation[loc].units += r.quantity;
      byLocation[loc].value += r.product.avgCost != null ? Number(r.product.avgCost) * r.quantity : 0;
    }

    // By category
    const byCategory: Record<string, { name: string; units: number; value: number }> = {};
    for (const r of stock) {
      const cat = r.product.category.name;
      if (!byCategory[cat]) byCategory[cat] = { name: cat, units: 0, value: 0 };
      byCategory[cat].units += r.quantity;
      byCategory[cat].value += r.product.avgCost != null ? Number(r.product.avgCost) * r.quantity : 0;
    }

    // Value received per month from approved GRNs (last 12 months)
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
    twelveMonthsAgo.setDate(1);
    twelveMonthsAgo.setHours(0, 0, 0, 0);
    const grnOrders = await prisma.order.findMany({
      where: { type: "GRN", grnStatus: "APPROVED", createdAt: { gte: twelveMonthsAgo } },
      include: { lines: { select: { quantity: true, unitCost: true } } },
      orderBy: { createdAt: "asc" },
    });
    const monthlyIn: Record<string, number> = {};
    for (const o of grnOrders) {
      const key = o.createdAt.toISOString().slice(0, 7);
      const val = o.lines.reduce((s, l) => s + (l.unitCost != null ? Number(l.unitCost) * l.quantity : 0), 0);
      monthlyIn[key] = (monthlyIn[key] ?? 0) + val;
    }

    // Top items by value
    const topItems = stock
      .filter((r) => r.product.avgCost != null)
      .map((r) => ({ name: r.product.name, sku: r.product.sku, location: r.location.name, qty: r.quantity, unit: r.product.unit.name, avgCost: Number(r.product.avgCost), value: Number(r.product.avgCost) * r.quantity }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 20);

    return NextResponse.json({
      overview: { totalValue, totalUnits, itemsWithCost: withCost.length, totalItems: stock.length },
      byLocation: Object.values(byLocation).sort((a, b) => b.value - a.value),
      byCategory: Object.values(byCategory).sort((a, b) => b.value - a.value),
      monthlyIn: Object.entries(monthlyIn).map(([month, value]) => ({ month, value })),
      topItems,
    });
  }

  if (report === "turnover") {
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
    const toDate = to ? new Date(to + "T23:59:59") : new Date();
    const dayRange = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000));

    const movements = await prisma.movement.findMany({
      where: {
        type: "OUT",
        createdAt: { gte: fromDate, lte: toDate },
        product: { isActive: true, ...(categoryId ? { categoryId } : {}) },
        ...(locationId ? { fromLocationId: locationId } : {}),
      },
      include: { product: { include: { category: true, unit: true } } },
    });

    // Aggregate by product
    const byProduct: Record<string, { name: string; sku: string; category: string; unit: string; moves: number; totalOut: number }> = {};
    for (const m of movements) {
      const pid = m.productId;
      if (!byProduct[pid]) byProduct[pid] = { name: m.product.name, sku: m.product.sku, category: m.product.category.name, unit: m.product.unit.name, moves: 0, totalOut: 0 };
      byProduct[pid].moves++;
      byProduct[pid].totalOut += m.quantity;
    }

    // Current stock per product to calculate turnover ratio
    const productIds = Object.keys(byProduct);
    const stockRows = productIds.length > 0 ? await prisma.stock.findMany({
      where: {
        productId: { in: productIds },
        ...(locationId ? { locationId } : {}),
      },
      select: { productId: true, quantity: true },
    }) : [];
    const stockByProduct: Record<string, number> = {};
    for (const s of stockRows) stockByProduct[s.productId] = (stockByProduct[s.productId] ?? 0) + s.quantity;

    const rows = Object.entries(byProduct).map(([pid, p]) => {
      const currentStock = stockByProduct[pid] ?? 0;
      const avgDailyOut = p.totalOut / dayRange;
      const daysOfStock = avgDailyOut > 0 ? Math.round(currentStock / avgDailyOut) : null;
      return { ...p, currentStock, avgDailyOut: Math.round(avgDailyOut * 10) / 10, daysOfStock };
    });

    // Sort by totalOut desc (fast movers first)
    rows.sort((a, b) => b.totalOut - a.totalOut);

    return NextResponse.json({ rows, dayRange, fromDate: fromDate.toISOString(), toDate: toDate.toISOString() });
  }

  if (report === "restock") {
    // Read-only: gathers existing data (stock, out-velocity, reorder points,
    // packaging, last cost/supplier) and runs the pure restock logic. No writes.
    const isAdmin = session.user.role === "ADMIN" || session.user.role === "VIEWER";
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
    const toDate = to ? new Date(to + "T23:59:59") : new Date();
    const dayRange = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000));
    const coverageDays = Math.max(1, parseInt(searchParams.get("coverageDays") ?? "30", 10) || 30);

    // Out-velocity per product over the window.
    const movements = await prisma.movement.findMany({
      where: {
        type: "OUT",
        createdAt: { gte: fromDate, lte: toDate },
        product: { isActive: true, ...(categoryId ? { categoryId } : {}) },
        ...(locationId ? { fromLocationId: locationId } : {}),
      },
      select: { productId: true, quantity: true },
    });
    const outByProduct: Record<string, number> = {};
    for (const m of movements) outByProduct[m.productId] = (outByProduct[m.productId] ?? 0) + m.quantity;

    // Candidate products: anything with a reorder point set, or anything that moved.
    const movedIds = Object.keys(outByProduct);
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        ...(categoryId ? { categoryId } : {}),
        OR: [{ reorderPoint: { gt: 0 } }, ...(movedIds.length ? [{ id: { in: movedIds } }] : [])],
      },
      include: { category: true, unit: true, unitConversions: true },
    });
    const productIds = products.map((p) => p.id);

    // Current stock per candidate (optionally at one location).
    const stockRows = productIds.length ? await prisma.stock.findMany({
      where: { productId: { in: productIds }, ...(locationId ? { locationId } : {}) },
      select: { productId: true, quantity: true },
    }) : [];
    const stockByProduct: Record<string, number> = {};
    for (const s of stockRows) stockByProduct[s.productId] = (stockByProduct[s.productId] ?? 0) + s.quantity;

    const inputs: RestockInput[] = products.map((p) => {
      const factors = p.unitConversions.map((uc) => uc.conversionFactor).filter((f) => f > 1);
      return {
        productId: p.id,
        name: p.name,
        sku: p.sku,
        category: p.category.name,
        unit: p.unit.name,
        reorderPoint: p.reorderPoint,
        currentStock: stockByProduct[p.id] ?? 0,
        totalOut: outByProduct[p.id] ?? 0,
        lastCost: isAdmin && p.lastCost != null ? Number(p.lastCost) : null,
        lastSupplier: null, // filled below for the resulting candidates only
        boxFactor: factors.length ? Math.max(...factors) : null,
      };
    });

    const rows = computeRestockSuggestions(inputs, { dayRange, coverageDays });

    // Attach the last supplier for the surfaced candidates only (small set).
    const candidateIds = rows.map((r) => r.productId);
    if (candidateIds.length) {
      const grnLines = await prisma.orderLine.findMany({
        where: { productId: { in: candidateIds }, order: { type: "GRN" } },
        select: { productId: true, order: { select: { createdAt: true, supplier: true, supplierRef: { select: { name: true } } } } },
        orderBy: { order: { createdAt: "desc" } },
      });
      const supplierByProduct: Record<string, string> = {};
      for (const l of grnLines) {
        if (supplierByProduct[l.productId]) continue; // first = most recent
        const name = l.order.supplierRef?.name ?? l.order.supplier ?? "";
        if (name) supplierByProduct[l.productId] = name;
      }
      for (const r of rows) r.lastSupplier = supplierByProduct[r.productId] ?? null;
    }

    const totalEstCost = isAdmin
      ? rows.reduce((s, r) => s + (r.estCost ?? 0), 0)
      : null;

    if (format === "xlsx") {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Restock");
      const header = ["Product", "SKU", "Category", "Urgency", "Current Stock", "Unit", "Reorder Pt", "Days Left", "Order Qty", "Last Supplier"];
      if (isAdmin) header.push("Last Cost", "Est. Cost");
      ws.addRow(header);
      for (const r of rows) {
        const row = [r.name, r.sku, r.category, r.urgency, r.currentStock, r.unit, r.reorderPoint, r.daysOfStock ?? "", r.suggestedQty, r.lastSupplier ?? ""];
        if (isAdmin) row.push(r.lastCost ?? "", r.estCost ?? "");
        ws.addRow(row);
      }
      const buf = await wb.xlsx.writeBuffer();
      return new NextResponse(buf, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="restock-${Date.now()}.xlsx"`,
        },
      });
    }

    return NextResponse.json({
      rows,
      dayRange,
      coverageDays,
      isAdmin,
      totalEstCost,
      fromDate: fromDate.toISOString(),
      toDate: toDate.toISOString(),
    });
  }

  return NextResponse.json({ error: "Unknown report" }, { status: 400 });
}
