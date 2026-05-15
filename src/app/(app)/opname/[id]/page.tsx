import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { OpnameCountSheet } from "@/components/opname-count-sheet";
import { blockOperator } from "@/lib/role-guard";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export default async function OpnameDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await blockOperator();
  const { id } = await params;
  const [authSession, opnameSession] = await Promise.all([
    getServerSession(authOptions),
    prisma.opnameSession.findUnique({
      where: { id },
      include: {
        location: true,
        lines: {
          include: { product: { include: { category: true, unit: true } } },
          orderBy: { product: { name: "asc" } },
        },
      },
    }),
  ]);
  if (!opnameSession) notFound();
  const isAdmin = authSession?.user.role === "ADMIN";

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <a href="/opname" className="text-xs text-slate-500 hover:underline">← Opname</a>
        <h1 className="text-base font-semibold text-slate-800 font-mono">{opnameSession.sessionNumber}</h1>
        <span className="text-xs text-slate-500">{opnameSession.location.name}</span>
      </div>
      <OpnameCountSheet session={opnameSession} isAdmin={isAdmin} />
    </div>
  );
}
