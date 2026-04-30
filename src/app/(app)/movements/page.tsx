import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { blockOperator } from "@/lib/role-guard";

const TYPE_BADGE: Record<string, string> = {
  IN: "bg-green-100 text-green-700", OUT: "bg-orange-100 text-orange-700",
  TRANSFER: "bg-blue-100 text-blue-700", ADJUSTMENT: "bg-gray-100 text-gray-600",
};

export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<{ locationId?: string; from?: string; to?: string; page?: string }>;
}) {
  await blockOperator();
  const params = await searchParams;
  const locationId = params.locationId ?? "";
  const from = params.from ?? "";
  const to = params.to ?? "";
  const page = Math.max(1, parseInt(params.page ?? "1"));
  const perPage = 50;

  const where = {
    ...(locationId ? { OR: [{ fromLocationId: locationId }, { toLocationId: locationId }] } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to + "T23:59:59") } : {}) } } : {}),
  };

  const [movements, total, locations] = await Promise.all([
    prisma.movement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      include: {
        product: { include: { unit: true } },
        fromLocation: true,
        toLocation: true,
        order: true,
        orderLine: { select: { inputQty: true, inputUnit: true } },
      },
    }),
    prisma.movement.count({ where }),
    prisma.location.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  const pages = Math.ceil(total / perPage);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-base font-semibold text-slate-800">Movement Log</h1>
        <a href={`/api/reports?report=movements&format=xlsx&locationId=${locationId}&from=${from}&to=${to}`}
          className="text-xs px-3 py-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
          ↓ Export Excel
        </a>
      </div>

      <form method="GET" className="flex gap-2 mb-4 flex-wrap">
        <select name="locationId" defaultValue={locationId}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All Locations</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <input type="date" name="from" defaultValue={from} className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
        <input type="date" name="to" defaultValue={to} className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
        <button type="submit" className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700">Filter</button>
        {(locationId || from || to) && <Link href="/movements" className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">Clear</Link>}
      </form>

      {/* Mobile card list */}
      <div className="md:hidden space-y-2">
        {movements.length === 0 ? (
          <p className="text-center text-slate-400 text-xs py-10">No movements found</p>
        ) : movements.map((m) => (
          <div key={m.id} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              {m.order ? (
                <Link href={`/orders/${m.orderId}`} className="font-mono text-xs text-blue-600 font-semibold">
                  {m.order.orderNumber}
                </Link>
              ) : (
                <span className="font-mono text-xs text-slate-400">{m.orderId.slice(0, 8)}…</span>
              )}
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_BADGE[m.type]}`}>
                {m.type}
              </span>
            </div>
            <div className="text-sm text-slate-800 font-medium">{m.product.name}</div>
            {m.product.sku && <div className="text-xs font-mono text-slate-400">{m.product.sku}</div>}
            <div className="flex items-center justify-between mt-1.5 text-xs text-slate-500">
              <span>
                {m.fromLocation?.name ?? "—"} → {m.toLocation?.name ?? "—"}
              </span>
              <span className="font-semibold text-slate-800">
                {m.orderLine?.inputQty != null
                  ? `${m.orderLine.inputQty} ${m.orderLine.inputUnit}`
                  : `${m.quantity} ${m.product.unit.name.toLowerCase()}`}
              </span>
            </div>
            <div className="text-xs text-slate-400 mt-1">
              {m.createdAt.toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })}
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="px-4 py-2.5 text-left font-medium">Date</th>
                <th className="px-4 py-2.5 text-left font-medium">Order</th>
                <th className="px-4 py-2.5 text-left font-medium">Type</th>
                <th className="px-4 py-2.5 text-left font-medium">Product</th>
                <th className="px-4 py-2.5 text-left font-medium">From</th>
                <th className="px-4 py-2.5 text-left font-medium">To</th>
                <th className="px-4 py-2.5 text-right font-medium">Qty</th>
              </tr>
            </thead>
            <tbody>
              {movements.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400 text-xs">No movements found</td></tr>
              ) : movements.map((m) => (
                <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-xs text-slate-500">
                    {m.createdAt.toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })}
                  </td>
                  <td className="px-4 py-2.5">
                    {m.order ? (
                      <Link href={`/orders/${m.orderId}`} className="font-mono text-xs text-blue-600 hover:underline">
                        {m.order.orderNumber}
                      </Link>
                    ) : (
                      <span className="font-mono text-xs text-slate-400">{m.orderId.slice(0, 8)}…</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_BADGE[m.type]}`}>
                      {m.type}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="text-slate-800">{m.product.name}</div>
                    <div className="text-xs font-mono text-slate-400">{m.product.sku ?? ""}</div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{m.fromLocation?.name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{m.toLocation?.name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right">
                    {m.orderLine?.inputQty != null ? (
                      <>
                        <div className="font-semibold text-slate-800">
                          {m.orderLine.inputQty} <span className="text-xs font-normal text-slate-400">{m.orderLine.inputUnit}</span>
                        </div>
                        <div className="text-xs text-slate-400">
                          = {m.quantity} {m.product.unit.name.toLowerCase()}
                        </div>
                      </>
                    ) : (
                      <span className="font-semibold text-slate-800">
                        {m.quantity} <span className="text-xs font-normal text-slate-400">{m.product.unit.name.toLowerCase()}</span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {pages > 1 && (
        <div className="flex gap-2 justify-center mt-4">
          {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
            <Link key={p} href={`/movements?locationId=${locationId}&from=${from}&to=${to}&page=${p}`}
              className={`px-3 py-1 rounded text-xs ${p === page ? "bg-blue-600 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
              {p}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
