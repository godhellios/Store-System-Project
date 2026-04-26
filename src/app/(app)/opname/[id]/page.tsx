import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { OpnameCountSheet } from "@/components/opname-count-sheet";

export default async function OpnameDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await prisma.opnameSession.findUnique({
    where: { id },
    include: {
      location: true,
      lines: {
        include: { product: { include: { category: true, unit: true } } },
        orderBy: { product: { name: "asc" } },
      },
    },
  });
  if (!session) notFound();

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <a href="/opname" className="text-xs text-slate-500 hover:underline">← Opname</a>
        <h1 className="text-base font-semibold text-slate-800 font-mono">{session.sessionNumber}</h1>
        <span className="text-xs text-slate-500">{session.location.name}</span>
      </div>
      <OpnameCountSheet session={session} />
    </div>
  );
}
