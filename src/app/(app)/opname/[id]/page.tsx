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
        categories: { select: { name: true } },
        lines: {
          select: {
            id: true,
            bookQty: true,
            physicalQty: true,
            difference: true,
            notes: true,
            staffConfirmed: true,
            product: {
              select: {
                name: true, sku: true,
                category: { select: { name: true } },
                unit: { select: { name: true } },
              },
            },
          },
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
        <span className="text-xs text-slate-400">
          · {opnameSession.categories.length ? opnameSession.categories.map((c) => c.name).join(", ") : "All categories"}
        </span>
      </div>
      <OpnameCountSheet
        session={{
          id: opnameSession.id,
          sessionNumber: opnameSession.sessionNumber,
          status: opnameSession.status,
          notes: opnameSession.notes,
          cancelNote: opnameSession.cancelNote,
          createdByName: opnameSession.createdByName,
          approvedByName: opnameSession.approvedByName,
          lines: opnameSession.lines,
        }}
        isAdmin={isAdmin}
      />
    </div>
  );
}
