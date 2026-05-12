import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const orders = await prisma.order.findMany({
    where: {
      cancelledAt: null,
      OR: [
        { type: "GRN", grnStatus: "PENDING" },
        { type: "GOODS_OUT", goodsOutStatus: "PENDING" },
        { type: "TRANSFER", transferStatus: "PENDING" },
        { type: "ADJUSTMENT", adjustmentStatus: "PENDING" },
      ],
    },
    include: {
      fromLocation: { select: { name: true } },
      toLocation: { select: { name: true } },
      lines: {
        include: {
          product: { select: { name: true, sku: true, unit: { select: { name: true } } } },
        },
        orderBy: { id: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(orders);
}
