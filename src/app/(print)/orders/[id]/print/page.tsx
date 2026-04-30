import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { PrintActions } from "./print-actions";

export default async function DeliveryOrderPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      fromLocation: true,
      toLocation: true,
      lines: {
        include: { product: { include: { unit: true, category: true } } },
        orderBy: { id: "asc" },
      },
    },
  });

  if (!order || order.type !== "GOODS_OUT") notFound();

  const date = order.createdAt.toLocaleDateString("id-ID", {
    day: "numeric", month: "long", year: "numeric",
  });

  const totalBaseQty = order.lines.reduce((s, l) => s + l.quantity, 0);

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          @page { size: A4; margin: 16mm 18mm; }
        }
      `}</style>

      {/* Screen toolbar */}
      <div className="no-print bg-slate-800 text-white px-6 py-3 flex items-center justify-between gap-4">
        <span className="text-sm font-medium">Delivery Order — {order.orderNumber}</span>
        <PrintActions orderId={id} />
      </div>

      {/* DO document */}
      <div className="bg-white min-h-screen p-10 print:p-0 max-w-[794px] mx-auto font-sans text-sm text-gray-900">

        {/* Header */}
        <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-gray-800">
          <div>
            <div className="text-2xl font-extrabold tracking-tight text-gray-900">
              MR<span className="text-sky-600">Is</span>
            </div>
            <div className="text-xs text-gray-500 mt-0.5">Mitra Ramah Inventory System</div>
          </div>
          <div className="text-right">
            <div className="text-xl font-bold uppercase tracking-widest text-gray-800">Delivery Order</div>
            <div className="mt-1 text-base font-mono font-semibold text-gray-700">{order.orderNumber}</div>
          </div>
        </div>

        {/* Meta info */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 mb-6 text-xs">
          <div className="flex gap-2">
            <span className="text-gray-500 w-24 shrink-0">Date</span>
            <span className="font-medium">{date}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-gray-500 w-24 shrink-0">DO Number</span>
            <span className="font-mono font-semibold">{order.orderNumber}</span>
          </div>
          {order.fromLocation && (
            <div className="flex gap-2">
              <span className="text-gray-500 w-24 shrink-0">Issued From</span>
              <span className="font-medium">{order.fromLocation.name}</span>
            </div>
          )}
          {order.reference && (
            <div className="flex gap-2">
              <span className="text-gray-500 w-24 shrink-0">Reference</span>
              <span className="font-medium">{order.reference}</span>
            </div>
          )}
          {order.notes && (
            <div className="col-span-2 flex gap-2">
              <span className="text-gray-500 w-24 shrink-0">Notes</span>
              <span>{order.notes}</span>
            </div>
          )}
        </div>

        {/* Items table */}
        <table className="w-full border-collapse mb-6 text-xs">
          <thead>
            <tr className="bg-gray-800 text-white">
              <th className="px-3 py-2 text-left font-semibold w-8">#</th>
              <th className="px-3 py-2 text-left font-semibold">Product</th>
              <th className="px-3 py-2 text-left font-semibold">SKU</th>
              <th className="px-3 py-2 text-right font-semibold">Qty</th>
              <th className="px-3 py-2 text-left font-semibold">Unit</th>
              <th className="px-3 py-2 text-right font-semibold">Base Qty</th>
              <th className="px-3 py-2 text-left font-semibold">Base Unit</th>
              <th className="px-3 py-2 text-left font-semibold">Notes</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line, i) => (
              <tr key={line.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                <td className="px-3 py-2 font-medium">{line.product.name}</td>
                <td className="px-3 py-2 font-mono text-gray-500">{line.product.sku}</td>
                <td className="px-3 py-2 text-right font-semibold">
                  {line.inputQty != null ? line.inputQty : line.quantity}
                </td>
                <td className="px-3 py-2">
                  {line.inputQty != null ? line.inputUnit : line.product.unit.name}
                </td>
                <td className="px-3 py-2 text-right">
                  {line.inputQty != null ? (
                    <span className="text-gray-600">{line.quantity}</span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-500">
                  {line.inputQty != null ? line.product.unit.name : ""}
                </td>
                <td className="px-3 py-2 text-gray-500">{line.notes ?? ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-300">
              <td colSpan={5} className="px-3 py-2 text-right text-xs text-gray-500 font-medium">
                Total ({order.lines.length} item{order.lines.length !== 1 ? "s" : ""})
              </td>
              <td className="px-3 py-2 text-right font-bold text-gray-900">{totalBaseQty}</td>
              <td colSpan={2} className="px-3 py-2 text-xs text-gray-500">base units</td>
            </tr>
          </tfoot>
        </table>

        {/* Signatures */}
        <div className="grid grid-cols-3 gap-6 mt-10">
          {[
            { label: "Prepared By", sub: "Signature / Name / Date" },
            { label: "Checked By", sub: "Signature / Name / Date" },
            { label: "Received By", sub: "Signature / Name / Date" },
          ].map(({ label, sub }) => (
            <div key={label} className="text-center">
              <div className="text-xs font-semibold text-gray-600 mb-1">{label}</div>
              <div className="h-16 border border-gray-300 rounded mb-1" />
              <div className="text-[10px] text-gray-400">{sub}</div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-8 pt-3 border-t border-gray-200 text-[10px] text-gray-400 text-center">
          Generated by MRIs — Mitra Ramah Inventory System &nbsp;|&nbsp; {order.orderNumber} &nbsp;|&nbsp; {date}
        </div>
      </div>
    </>
  );
}
