import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { name, phone, address, notes, isActive } = await req.json();

  if (name !== undefined) {
    if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    const conflict = await prisma.supplier.findFirst({ where: { name: name.trim(), NOT: { id } } });
    if (conflict) return NextResponse.json({ error: "Supplier name already exists" }, { status: 409 });
  }

  const supplier = await prisma.supplier.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(phone !== undefined ? { phone: phone?.trim() || null } : {}),
      ...(address !== undefined ? { address: address?.trim() || null } : {}),
      ...(notes !== undefined ? { notes: notes?.trim() || null } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
    },
  });
  writeAuditLog({ session, action: "EDIT_SUPPLIER", description: `"${supplier.name}"`, entityId: supplier.id, entityType: "SUPPLIER" });
  return NextResponse.json(supplier);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const count = await prisma.order.count({ where: { supplierId: id } });
  if (count > 0) {
    await prisma.supplier.update({ where: { id }, data: { isActive: false } });
    return NextResponse.json({ deactivated: true });
  }
  const supplier = await prisma.supplier.delete({ where: { id } });
  writeAuditLog({ session, action: "DELETE_SUPPLIER", description: `"${supplier.name}"`, entityId: id, entityType: "SUPPLIER" });
  return NextResponse.json({ deleted: true });
}
