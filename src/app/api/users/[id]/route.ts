import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { name, email, role, isActive, password } = await req.json();

  if (email) {
    const conflict = await prisma.user.findFirst({
      where: { email: email.trim().toLowerCase(), NOT: { id } },
    });
    if (conflict) return NextResponse.json({ error: "Email already in use" }, { status: 409 });
  }

  const user = await prisma.user.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(email !== undefined ? { email: email.trim().toLowerCase() } : {}),
      ...(role !== undefined ? { role } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(password ? { password: await bcrypt.hash(password, 10) } : {}),
    },
    select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
  });
  return NextResponse.json(user);
}
