import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json() as { whatsappSentAt?: boolean; printedAt?: boolean; doGeneratedAt?: boolean; doSentAt?: boolean };

  const now = new Date();
  const data = {
    ...(body.whatsappSentAt ? { whatsappSentAt: now } : {}),
    ...(body.printedAt ? { printedAt: now } : {}),
  };

  if (body.doGeneratedAt) {
    // Only record the first time the DO is generated — updateMany silently skips if already set
    await prisma.order.updateMany({ where: { id, doGeneratedAt: null }, data: { doGeneratedAt: now } });
  }

  if (body.doSentAt) {
    await prisma.order.updateMany({ where: { id, doSentAt: null }, data: { doSentAt: now } });
  }

  if (!Object.keys(data).length && !body.doGeneratedAt && !body.doSentAt)
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const order = Object.keys(data).length
    ? await prisma.order.update({ where: { id }, data })
    : await prisma.order.findUnique({ where: { id } });
  return NextResponse.json(order);
}
