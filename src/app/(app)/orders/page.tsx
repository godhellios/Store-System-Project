import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { OrderType } from "@/generated/prisma";
import { blockOperator } from "@/lib/role-guard";

const TYPE_BADGE: Record<string, string> = {
  GRN: "bg-green-100 text-green-700",
  GOODS_OUT: "bg-orange-100 text-orange-700",
  TRANSFER: "bg-blue-100 text-blue-700",
  ADJUSTMENT: "bg-gray-100 text-gray-600",
};
const TYPE_LABEL: Record<string, string> = {
  GRN: "GRN", GOODS_OUT: "Goods Out", TRANSFER: "Transfer", ADJUSTMENT: "Adjustment",
};

function summariseLines(lines: { quantity: number; product: { category: { name: string } } }[]) {
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0);
  const cats = [...new Set(lines.map((l) => l.product.category.name))];
  const catLabel = cats.length <= 2 ? cats.join(", ") : `${cats.slice(0, 2).join(", ")} +${cats.length - 2}`;
  return { totalQty, catLabel };
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; page?: string }>;
}) {
  await blockOperator();
  const params = await searchParams;
  const typeFilter = params.type as OrderType | undefined;
  const page = Math.max(1, parseInt(params.page ?? "1"));
  const perPage = 25;

  const where = { ...(typeFilter ? { type: typeFilter } : {}) };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      include: {
        fromLocation: true,
        toLocation: true,
        lines: { include: { product: { include: { category: true } } } },
      },
    }),
    prisma.order.count({ where }),
  ]);

  const pages = Math.ceil(total / perPage);

  return (
    <div>
      <h1 className="text-base font-semibold text-slate-800 mb-5">Order History</h1>

      <div className="flex gap-2 mb-4 flex-wrap">
        {[undefined, "GRN", "GOODS_OUT", "TRANSFER", "ADJUSTMENT"].map((t) => (
          <Link key={t ?? "all"} href={t ? `/orders?type=${t}` : "/orders"}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${typeFilter === t || (!typeFilter && !t) ? "bg-blue-600 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
            {t ? TYPE_LABEL[t] : "All"}
          </Link>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <th className="px-4 py-2.5 text-left font-medium">Document</th>
              <th className="px-4 py-2.5 text-left font-medium">Type</th>
              <th className="px-4 py-2.5 text-left font-medium">Location(s)</th>
              <th className="px-4 py-2.5 text-left font-medium">Qty · Categories</th>
              <th className="px-4 py-2.5 text-left font-medium">Reference</th>
              <th className="px-4 py-2.5 text-left font-medium">Date</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400 text-xs">No orders yet</td></tr>
            ) : orders.map((o) => {
              const { totalQty, catLabel } = summariseLines(o.lines);
              return (
                <tr key={o.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-mono font-semibold text-blue-600 text-xs">{o.orderNumber}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_BADGE[o.type]}`}>
                      {TYPE_LABEL[o.type]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">
                    {o.type === "TRANSFER"
                      ? `${o.fromLocation?.name ?? "?"} → ${o.toLocation?.name ?? "?"}`
                      : o.type === "GRN" || o.type === "ADJUSTMENT"
                      ? o.toLocation?.name ?? "—"
                      : o.fromLocation?.name ?? "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-gray-900 text-xs">{totalQty} pcs</div>
                    <div className="text-xs text-slate-400 mt-0.5">{catLabel || "—"}</div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-400">{o.reference ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">
                    {o.createdAt.toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-4 py-2.5">
                    <Link href={`/orders/${o.id}`} className="text-xs text-blue-600 hover:underline">View</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex gap-2 justify-center mt-4">
          {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
            <Link key={p} href={`/orders?type=${typeFilter ?? ""}&page=${p}`}
              className={`px-3 py-1 rounded text-xs ${p === page ? "bg-blue-600 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
              {p}
            </Link>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-400 mt-3 text-right">{total} order{total !== 1 ? "s" : ""} total</p>
    </div>
  );
}
