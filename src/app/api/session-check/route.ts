import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ valid: false });
  if (session.user.role === "ADMIN" || !session.user.sessionId) {
    return NextResponse.json({ valid: true });
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { activeSessionId: true },
  });

  return NextResponse.json({ valid: dbUser?.activeSessionId === session.user.sessionId });
}
