import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "STAFF"].includes(session.user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { locationId, rows } = await req.json() as {
    locationId: string;
    rows: Array<{ productId: string; physicalQty: number; notes: string }>;
  };

  if (!locationId) return NextResponse.json({ error: "Location is required" }, { status: 400 });
  if (!rows?.length) return NextResponse.json({ error: "No rows to import" }, { status: 400 });

  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) return NextResponse.json({ error: "Location not found" }, { status: 404 });

  // Generate session number
  const year = new Date().getFullYear();
  const count = await prisma.opnameSession.count({
    where: { sessionNumber: { startsWith: `OPN-${year}-` } },
  });
  const sessionNumber = `OPN-${year}-${String(count + 1).padStart(4, "0")}`;

  // Fetch current stock for all products in the import
  const productIds = rows.map((r) => r.productId);
  const stockRecords = await prisma.stock.findMany({
    where: { locationId, productId: { in: productIds } },
  });
  const stockMap = new Map(stockRecords.map((s) => [s.productId, s.quantity]));

  const opnameSession = await prisma.opnameSession.create({
    data: {
      sessionNumber,
      locationId,
      status: "REVIEWING",
      notes: `Imported from Excel — ${rows.length} item(s) counted`,
      lines: {
        create: rows.map((r) => {
          const bookQty = stockMap.get(r.productId) ?? 0;
          return {
            productId: r.productId,
            bookQty,
            physicalQty: r.physicalQty,
            difference: r.physicalQty - bookQty,
            notes: r.notes || null,
          };
        }),
      },
    },
  });

  return NextResponse.json({ sessionId: opnameSession.id, sessionNumber: opnameSession.sessionNumber });
}
