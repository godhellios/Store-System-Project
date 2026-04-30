import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json() as { whatsappSentAt?: boolean; printedAt?: boolean };

  const now = new Date();
  const data = {
    ...(body.whatsappSentAt ? { whatsappSentAt: now } : {}),
    ...(body.printedAt ? { printedAt: now } : {}),
  };

  if (!Object.keys(data).length)
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const order = await prisma.order.update({ where: { id }, data });
  return NextResponse.json(order);
}
