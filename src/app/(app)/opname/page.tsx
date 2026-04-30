import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { NewOpnameButton } from "@/components/new-opname-button";
import CancelOpnameButton from "@/components/cancel-opname-button";
import DeleteOpnameButton from "@/components/delete-opname-button";
import { blockOperator } from "@/lib/role-guard";
import { OpnameExportButton } from "@/components/opname-export-button";
import { OpnameImportButton } from "@/components/opname-import-button";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const STATUS_BADGE: Record<string, string> = {
  IN_PROGRESS: "bg-yellow-100 text-yellow-700",
  REVIEWING: "bg-blue-100 text-blue-700",
  APPROVED: "bg-green-100 text-green-700",
};

export default async function OpnamePage() {
  await blockOperator();
  const authSession = await getServerSession(authOptions);
  const isAdmin = authSession?.user.role === "ADMIN";

  const [sessions, locations] = await Promise.all([
    prisma.opnameSession.findMany({
      orderBy: { createdAt: "desc" },
      include: { location: true, _count: { select: { lines: true } } },
    }),
    prisma.location.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-base font-semibold text-slate-800">Stock Opname</h1>
        <div className="flex items-center gap-2">
          <OpnameExportButton locations={locations} />
          <OpnameImportButton locations={locations} />
          <NewOpnameButton locations={locations} />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <th className="px-4 py-2.5 text-left font-medium">Session #</th>
              <th className="px-4 py-2.5 text-left font-medium">Location</th>
              <th className="px-4 py-2.5 text-left font-medium">Status</th>
              <th className="px-4 py-2.5 text-left font-medium">Lines</th>
              <th className="px-4 py-2.5 text-left font-medium">Created</th>
              <th className="px-4 py-2.5 text-left font-medium">Approved</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400 text-xs">No opname sessions yet</td></tr>
            ) : sessions.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2.5 font-mono font-semibold text-blue-600 text-xs">{s.sessionNumber}</td>
                <td className="px-4 py-2.5 text-slate-700">{s.location.name}</td>
                <td className="px-4 py-2.5">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[s.status]}`}>
                    {s.status.replace("_", " ")}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-slate-600">{s._count.lines}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">
                  {s.createdAt.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" })}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-500">
                  {s.approvedAt ? s.approvedAt.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" }) : "—"}
                </td>
                <td className="px-4 py-2.5 flex gap-3 items-center">
                  <Link href={`/opname/${s.id}`} className="text-xs text-blue-600 hover:underline">
                    {s.status === "IN_PROGRESS" ? "Count" : "View"}
                  </Link>
                  {s.status === "IN_PROGRESS" && (
                    <CancelOpnameButton sessionId={s.id} sessionNumber={s.sessionNumber} />
                  )}
                  {s.status !== "IN_PROGRESS" && isAdmin && (
                    <DeleteOpnameButton sessionId={s.id} sessionNumber={s.sessionNumber} status={s.status} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
