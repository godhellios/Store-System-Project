import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const suppliers = await prisma.supplier.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    include: { _count: { select: { orders: true } } },
  });
  return NextResponse.json(suppliers);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { name, phone, address, notes } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const existing = await prisma.supplier.findUnique({ where: { name: name.trim() } });
  if (existing) return NextResponse.json({ error: "Supplier already exists" }, { status: 409 });

  const supplier = await prisma.supplier.create({
    data: { name: name.trim(), phone: phone?.trim() || null, address: address?.trim() || null, notes: notes?.trim() || null },
  });
  writeAuditLog({ session, action: "CREATE_SUPPLIER", description: `"${supplier.name}"`, entityId: supplier.id, entityType: "SUPPLIER" });
  return NextResponse.json(supplier, { status: 201 });
}
