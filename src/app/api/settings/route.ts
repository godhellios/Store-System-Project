import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await prisma.systemSetting.findMany().catch(() => []);
  const result = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return NextResponse.json(result);
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN")
    return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const { key, value } = await req.json();
  if (!key || value === undefined)
    return NextResponse.json({ error: "key and value are required" }, { status: 400 });

  const setting = await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: String(value) },
    update: { value: String(value) },
  });
  return NextResponse.json(setting);
}
