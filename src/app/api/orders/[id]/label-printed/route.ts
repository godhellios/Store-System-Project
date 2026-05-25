import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { printed } = await req.json() as { printed: boolean };

  const order = await prisma.order.findUnique({ where: { id }, select: { id: true, type: true, grnStatus: true } });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (order.type !== "GRN") return NextResponse.json({ error: "Not a GRN" }, { status: 400 });
  if (order.grnStatus !== "APPROVED" && order.grnStatus !== null) {
    return NextResponse.json({ error: "GRN not approved" }, { status: 400 });
  }

  const updated = await prisma.order.update({
    where: { id },
    data: printed
      ? { labelPrinted: true, labelPrintedAt: new Date(), labelPrintedByName: session.user.name }
      : { labelPrinted: false, labelPrintedAt: null, labelPrintedByName: null },
    select: { labelPrinted: true, labelPrintedAt: true, labelPrintedByName: true },
  });

  return NextResponse.json(updated);
}
