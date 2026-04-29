import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  const stock = await prisma.stock.findUnique({ where: { id } });
  if (!stock) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.stock.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
