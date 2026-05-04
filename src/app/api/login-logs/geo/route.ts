import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { lat, lng } = await req.json() as { lat: number; lng: number };
  if (typeof lat !== "number" || typeof lng !== "number")
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });

  // Find the most recent login for this user without GPS yet
  const log = await prisma.loginLog.findFirst({
    where: { userId: session.user.id, lat: null },
    orderBy: { createdAt: "desc" },
  });

  if (!log) return NextResponse.json({ ok: false });

  await prisma.loginLog.update({
    where: { id: log.id },
    data: { lat, lng },
  });

  return NextResponse.json({ ok: true });
}
