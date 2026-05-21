import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const products = await prisma.product.findMany({
    where: { isActive: true },
    include: { category: true, unit: true },
    orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
  });

  const headers = [
    "name", "sku", "barcode", "category", "unit",
    "reorderPoint", "colorVariant", "description",
    "currentAvgCost", "openingCost", "correctCost",
  ];

  const rows = products.map((p) => [
    csvCell(p.name),
    csvCell(p.sku),
    csvCell(p.barcode),
    csvCell(p.category.name),
    csvCell(p.unit.name),
    csvCell(p.reorderPoint),
    csvCell(p.colorVariant),
    csvCell(p.description),
    csvCell(p.avgCost !== null ? Number(p.avgCost) : ""),
    csvCell(""),
    csvCell(""),
  ].join(","));

  const csv = [headers.join(","), ...rows].join("\r\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="mris-products-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
