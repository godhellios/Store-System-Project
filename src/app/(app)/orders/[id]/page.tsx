import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { notFound } from "next/navigation";
import { blockOperator } from "@/lib/role-guard";
import { OrderActions } from "@/components/order-actions";
import { GoodsOutDetailActions } from "@/components/goods-out-detail-actions";

const TYPE_BADGE: Record<string, string> = {
  GRN: "bg-green-100 text-green-700", GOODS_OUT: "bg-orange-100 text-orange-700",
  TRANSFER: "bg-blue-100 text-blue-700", ADJUSTMENT: "bg-gray-100 text-gray-600",
};
const TYPE_LABEL: Record<string, string> = {
  GRN: "GRN", GOODS_OUT: "Goods Out", TRANSFER: "Transfer", ADJUSTMENT: "Adjustment",
};

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await blockOperator();
  const userRole = session.user.role;

  const { id } = await params;
  const [order, waSetting] = await Promise.all([
    prisma.order.findUnique({
      where: { id },
      include: {
        fromLocation: true,
        toLocation: true,
        lines: { include: { product: { include: { category: true, unit: true } } }, orderBy: { id: "asc" } },
      },
    }),
    prisma.systemSetting.findUnique({ where: { key: "whatsapp_number" } }),
  ]);
  if (!order) notFound();
  const whatsappNumber = waSetting?.value ?? "6281283118487";

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Link href="/orders" className="hover:text-slate-800">Orders</Link>
          <span>/</span>
          <span className="text-slate-800 font-medium font-mono">{order.orderNumber}</span>
          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_BADGE[order.type]}`}>
            {TYPE_LABEL[order.type]}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {order.type === "GOODS_OUT" && (
            <>
              {order.whatsappSentAt && (
                <span className="text-[10px] px-2 py-1 bg-green-100 text-green-700 rounded-full font-medium">
                  WA Sent
                </span>
              )}
              {order.printedAt && (
                <span className="text-[10px] px-2 py-1 bg-slate-100 text-slate-600 rounded-full font-medium">
                  Printed
                </span>
              )}
              <GoodsOutDetailActions
                orderId={id}
                orderNumber={order.orderNumber}
                customer={order.customer}
                fromLocationName={order.fromLocation?.name ?? null}
                lines={order.lines}
                notes={order.notes}
                whatsappNumber={whatsappNumber}
                createdAt={order.createdAt}
                savedBy={order.createdByName}
              />
            </>
          )}
          <OrderActions orderId={id} userRole={userRole} />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4 grid grid-cols-2 gap-4 text-sm text-gray-900">
        <div>
          <span className="text-xs text-slate-500 block mb-0.5">Date</span>
          {order.createdAt.toLocaleString("id-ID", { dateStyle: "full", timeStyle: "short", timeZone: "Asia/Jakarta" })}
        </div>
        {order.fromLocation && (
          <div>
            <span className="text-xs text-slate-500 block mb-0.5">From</span>
            {order.fromLocation.name}
          </div>
        )}
        {order.toLocation && (
          <div>
            <span className="text-xs text-slate-500 block mb-0.5">To</span>
            {order.toLocation.name}
          </div>
        )}
        {order.customer && (
          <div>
            <span className="text-xs text-slate-500 block mb-0.5">Customer</span>
            {order.customer}
          </div>
        )}
        {order.reference && (
          <div>
            <span className="text-xs text-slate-500 block mb-0.5">Reference</span>
            {order.reference}
          </div>
        )}
        {order.notes && (
          <div className="col-span-2">
            <span className="text-xs text-slate-500 block mb-0.5">Notes</span>
            {order.notes}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="px-4 py-2.5 text-left font-medium">#</th>
                <th className="px-4 py-2.5 text-left font-medium">Product</th>
                <th className="px-4 py-2.5 text-left font-medium">Category</th>
                <th className="px-4 py-2.5 text-right font-medium">Qty (input)</th>
                <th className="px-4 py-2.5 text-right font-medium">Base qty</th>
                <th className="px-4 py-2.5 text-left font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line, i) => (
                <tr key={line.id} className="border-t border-slate-100">
                  <td className="px-4 py-2.5 text-slate-500 text-xs">{i + 1}</td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-gray-900">{line.product.name}</div>
                    <div className="text-xs font-mono text-slate-500">{line.product.sku}</div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-700">{line.product.category.name}</td>
                  <td className="px-4 py-2.5 text-right">
                    {line.inputQty != null ? (
                      <span className="font-semibold text-gray-900">
                        {line.inputQty} <span className="text-xs font-normal text-slate-500">{line.inputUnit}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="font-semibold text-gray-900">{line.quantity}</span>
                    <span className="text-xs font-normal text-slate-500 ml-1">{line.product.unit.name}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-700">{line.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-slate-100 text-xs text-slate-600 text-right">
          {order.lines.length} line{order.lines.length !== 1 ? "s" : ""} · {order.lines.reduce((s, l) => s + l.quantity, 0)} items total
        </div>
      </div>
    </div>
  );
}
