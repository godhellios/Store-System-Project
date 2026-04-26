import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { notFound } from "next/navigation";

const TYPE_BADGE: Record<string, string> = {
  GRN: "bg-green-100 text-green-700", GOODS_OUT: "bg-orange-100 text-orange-700",
  TRANSFER: "bg-blue-100 text-blue-700", ADJUSTMENT: "bg-gray-100 text-gray-600",
};
const TYPE_LABEL: Record<string, string> = {
  GRN: "GRN", GOODS_OUT: "Goods Out", TRANSFER: "Transfer", ADJUSTMENT: "Adjustment",
};

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      fromLocation: true,
      toLocation: true,
      lines: { include: { product: { include: { category: true, unit: true } } } },
    },
  });
  if (!order) notFound();

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-5">
        <Link href="/orders" className="text-xs text-slate-500 hover:underline">← Orders</Link>
        <h1 className="text-base font-semibold text-slate-800 font-mono">{order.orderNumber}</h1>
        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_BADGE[order.type]}`}>
          {TYPE_LABEL[order.type]}
        </span>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4 grid grid-cols-2 gap-4 text-sm text-gray-900">
        <div><span className="text-xs text-slate-500 block mb-0.5">Date</span>
          {order.createdAt.toLocaleString("id-ID", { dateStyle: "full", timeStyle: "short" })}</div>
        {order.fromLocation && <div><span className="text-xs text-slate-500 block mb-0.5">From</span>{order.fromLocation.name}</div>}
        {order.toLocation && <div><span className="text-xs text-slate-500 block mb-0.5">To</span>{order.toLocation.name}</div>}
        {order.reference && <div><span className="text-xs text-slate-500 block mb-0.5">Reference</span>{order.reference}</div>}
        {order.notes && <div className="col-span-2"><span className="text-xs text-slate-500 block mb-0.5">Notes</span>{order.notes}</div>}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <th className="px-4 py-2.5 text-left font-medium">#</th>
              <th className="px-4 py-2.5 text-left font-medium">Product</th>
              <th className="px-4 py-2.5 text-left font-medium">Category</th>
              <th className="px-4 py-2.5 text-right font-medium">Qty</th>
              <th className="px-4 py-2.5 text-left font-medium">Unit</th>
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
                <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{line.quantity}</td>
                <td className="px-4 py-2.5 text-xs text-gray-700">{line.product.unit.name}</td>
                <td className="px-4 py-2.5 text-xs text-gray-700">{line.notes ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-3 border-t border-slate-100 text-xs text-slate-600 text-right">
          {order.lines.length} line{order.lines.length !== 1 ? "s" : ""} · {order.lines.reduce((s, l) => s + l.quantity, 0)} items total
        </div>
      </div>
    </div>
  );
}
