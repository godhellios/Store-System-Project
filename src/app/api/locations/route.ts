import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const locations = await prisma.location.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { stock: true } } },
  });
  return NextResponse.json(locations);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name, type } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (!type?.trim()) return NextResponse.json({ error: "Type is required" }, { status: 400 });

  const existing = await prisma.location.findUnique({ where: { name: name.trim() } });
  if (existing) return NextResponse.json({ error: "Location already exists" }, { status: 409 });

  const location = await prisma.location.create({ data: { name: name.trim(), type: type.trim() } });
  return NextResponse.json(location, { status: 201 });
}
