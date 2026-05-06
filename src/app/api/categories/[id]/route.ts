import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { name, isActive, code: rawCode } = await req.json();

  if (name !== undefined) {
    const conflict = await prisma.category.findFirst({ where: { name: name.trim(), NOT: { id } } });
    if (conflict) return NextResponse.json({ error: "Name already in use" }, { status: 409 });
  }

  const code = rawCode !== undefined ? (rawCode ? rawCode.toUpperCase().trim() : null) : undefined;
  if (code !== undefined && code !== null && !/^[A-Z]{2,4}$/.test(code))
    return NextResponse.json({ error: "SKU Code must be 2–4 uppercase letters (e.g. BTN)" }, { status: 400 });

  if (code !== undefined && code !== null) {
    const codeConflict = await prisma.category.findFirst({ where: { code, NOT: { id } } });
    if (codeConflict)
      return NextResponse.json(
        { error: `Code '${code}' is already used by category '${codeConflict.name}'. Please choose a different code.` },
        { status: 400 }
      );
  }

  // Warn if changing code and products exist with SKUs starting with old code
  let warning: string | undefined;
  if (code !== undefined) {
    const current = await prisma.category.findUnique({ where: { id }, select: { code: true } });
    if (current?.code && current.code !== code) {
      const affectedCount = await prisma.product.count({
        where: { categoryId: id, sku: { startsWith: current.code } },
      });
      if (affectedCount > 0) warning = "Changing this code won't affect existing SKUs.";
    }
  }

  const category = await prisma.category.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(code !== undefined ? { code } : {}),
    },
  });
  return NextResponse.json(warning ? { ...category, warning } : category);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const inUse = await prisma.product.count({ where: { categoryId: id } });
  if (inUse > 0) {
    return NextResponse.json(
      { error: `Cannot delete — ${inUse} product(s) use this category. Deactivate it instead.` },
      { status: 409 }
    );
  }

  await prisma.category.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
