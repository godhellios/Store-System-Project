import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { viewerGuard } from "@/lib/role-guard";
import { writeAuditLog } from "@/lib/audit-log";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { products: true } } },
  });
  return NextResponse.json(categories);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { name, code: rawCode } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const code = rawCode ? rawCode.toUpperCase().trim() : null;
  if (code && !/^[A-Z]{2,4}$/.test(code))
    return NextResponse.json({ error: "SKU Code must be 2–4 uppercase letters (e.g. BTN)" }, { status: 400 });

  if (code) {
    const codeConflict = await prisma.category.findUnique({ where: { code } });
    if (codeConflict)
      return NextResponse.json(
        { error: `Code '${code}' is already used by category '${codeConflict.name}'. Please choose a different code.` },
        { status: 400 }
      );
  }

  const existing = await prisma.category.findUnique({ where: { name: name.trim() } });
  if (existing) return NextResponse.json({ error: "Category already exists" }, { status: 409 });

  const category = await prisma.category.create({ data: { name: name.trim(), code } });
  writeAuditLog({ session, action: "CREATE_CATEGORY", description: `"${category.name}"${code ? ` (${code})` : ""}`, entityId: category.id, entityType: "CATEGORY" });
  return NextResponse.json(category, { status: 201 });
}
