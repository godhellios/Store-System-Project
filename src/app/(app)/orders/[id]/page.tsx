import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { notFound } from "next/navigation";
import { blockOperator } from "@/lib/role-guard";
import { OrderActions } from "@/components/order-actions";
import { GoodsOutDetailActions } from "@/components/goods-out-detail-actions";
import { getT } from "@/modules/i18n";

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
  const [order, waSetting, t] = await Promise.all([
    prisma.order.findUnique({
      where: { id },
      include: {
        fromLocation: true,
        toLocation: true,
        lines: { include: { product: { include: { category: true, unit: true } } }, orderBy: { id: "asc" } },
      },
    }),
    prisma.systemSetting.findUnique({ where: { key: "whatsapp_number" } }),
    getT(),
  ]);
  if (!order) notFound();
  const whatsappNumber = waSetting?.value ?? "6281283118487";

  return (
    <div className="max-w-3xl">
      {order.type === "GRN" && order.grnStatus === "PENDING" && (
        <div className="bg-amber-50 border border-amber-300 border-l-4 border-l-amber-500 rounded-xl px-4 py-3 mb-4">
          <div className="text-sm font-semibold text-amber-700">Awaiting admin approval</div>
          <div className="text-xs text-amber-600 mt-0.5">Stock will only be credited once an admin approves this GRN.</div>
        </div>
      )}
      {order.type === "GOODS_OUT" && order.goodsOutStatus === "PENDING" && (
        <div className="bg-amber-50 border border-amber-300 border-l-4 border-l-amber-500 rounded-xl px-4 py-3 mb-4">
          <div className="text-sm font-semibold text-amber-700">Awaiting admin approval</div>
          <div className="text-xs text-amber-600 mt-0.5">Stock will only be deducted once an admin approves this Goods Out.</div>
        </div>
      )}
      {order.type === "TRANSFER" && order.transferStatus === "PENDING" && (
        <div className="bg-amber-50 border border-amber-300 border-l-4 border-l-amber-500 rounded-xl px-4 py-3 mb-4">
          <div className="text-sm font-semibold text-amber-700">Awaiting admin approval</div>
          <div className="text-xs text-amber-600 mt-0.5">Stock will only be moved once an admin approves this Transfer.</div>
        </div>
      )}
      {order.type === "GOODS_OUT" && order.goodsOutStatus === "REJECTED" && (
        <div className="bg-red-50 border border-red-300 border-l-4 border-l-red-500 rounded-xl px-4 py-3 mb-4">
          <div className="text-sm font-semibold text-red-700">Goods Out Rejected — stock was not deducted</div>
          <div className="text-xs text-red-600 mt-0.5">
            Reviewed by <span className="font-medium">{order.reviewedByName ?? "Admin"}</span>
            {order.reviewedAt && <> · {new Date(order.reviewedAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" })}</>}
          </div>
          {order.reviewNote && <div className="text-xs text-red-600 mt-1">Reason: <span className="font-medium">{order.reviewNote}</span></div>}
        </div>
      )}
      {order.type === "TRANSFER" && order.transferStatus === "REJECTED" && (
        <div className="bg-red-50 border border-red-300 border-l-4 border-l-red-500 rounded-xl px-4 py-3 mb-4">
          <div className="text-sm font-semibold text-red-700">Transfer Rejected — stock was not moved</div>
          <div className="text-xs text-red-600 mt-0.5">
            Reviewed by <span className="font-medium">{order.reviewedByName ?? "Admin"}</span>
            {order.reviewedAt && <> · {new Date(order.reviewedAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" })}</>}
          </div>
          {order.reviewNote && <div className="text-xs text-red-600 mt-1">Reason: <span className="font-medium">{order.reviewNote}</span></div>}
        </div>
      )}
      {order.type === "GRN" && order.grnStatus === "REJECTED" && (
        <div className="bg-red-50 border border-red-300 border-l-4 border-l-red-500 rounded-xl px-4 py-3 mb-4">
          <div className="text-sm font-semibold text-red-700">GRN Rejected — stock was not credited</div>
          <div className="text-xs text-red-600 mt-0.5">
            Reviewed by <span className="font-medium">{order.reviewedByName ?? "Admin"}</span>
            {order.reviewedAt && <> · {new Date(order.reviewedAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" })}</>}
          </div>
          {order.reviewNote && <div className="text-xs text-red-600 mt-1">Reason: <span className="font-medium">{order.reviewNote}</span></div>}
        </div>
      )}
      {order.cancelledAt && (
        <div className="bg-red-50 border border-red-300 border-l-4 border-l-red-500 rounded-xl px-4 py-3 mb-4">
          <div className="text-sm font-semibold text-red-700">This order has been cancelled</div>
          <div className="text-xs text-red-600 mt-0.5">
            Stock reversed · Cancelled by <span className="font-medium">{order.cancelledByName ?? "Admin"}</span>
            {" · "}{new Date(order.cancelledAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" })}
          </div>
          {order.cancelReason && (
            <div className="text-xs text-red-600 mt-1">Reason: <span className="font-medium">{order.cancelReason}</span></div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Link href="/orders" className="hover:text-slate-800">{t("orders.breadcrumb", "Orders")}</Link>
          <span>/</span>
          <span className="text-slate-800 font-medium font-mono">{order.orderNumber}</span>
          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_BADGE[order.type]}`}>
            {TYPE_LABEL[order.type]}
          </span>
          {order.cancelledAt && (
            <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
              CANCELLED
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {order.type === "GOODS_OUT" && !order.cancelledAt && (
            <>
              {order.whatsappSentAt && (
                <span className="text-[10px] px-2 py-1 bg-green-100 text-green-700 rounded-full font-medium">
                  {t("orderDetail.waSent", "WA Sent")}
                </span>
              )}
              {order.printedAt && (
                <span className="text-[10px] px-2 py-1 bg-slate-100 text-slate-600 rounded-full font-medium">
                  {t("orderDetail.printed", "Printed")}
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
          <OrderActions
            orderId={id}
            userRole={userRole}
            cancelledAt={order.cancelledAt?.toISOString() ?? null}
            adjustmentStatus={order.adjustmentStatus ?? null}
            grnStatus={order.grnStatus ?? null}
            goodsOutStatus={order.goodsOutStatus ?? null}
            transferStatus={order.transferStatus ?? null}
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4 grid grid-cols-2 gap-4 text-sm text-gray-900">
        <div>
          <span className="text-xs text-slate-500 block mb-0.5">{t("orderDetail.fields.date", "Date")}</span>
          {order.createdAt.toLocaleString("id-ID", { dateStyle: "full", timeStyle: "short", timeZone: "Asia/Jakarta" })}
        </div>
        {order.fromLocation && (
          <div>
            <span className="text-xs text-slate-500 block mb-0.5">{t("orderDetail.fields.from", "From")}</span>
            {order.fromLocation.name}
          </div>
        )}
        {order.toLocation && (
          <div>
            <span className="text-xs text-slate-500 block mb-0.5">{t("orderDetail.fields.to", "To")}</span>
            {order.toLocation.name}
          </div>
        )}
        {order.customer && (
          <div>
            <span className="text-xs text-slate-500 block mb-0.5">{t("orderDetail.fields.customer", "Customer")}</span>
            {order.customer}
          </div>
        )}
        {order.reference && (
          <div>
            <span className="text-xs text-slate-500 block mb-0.5">{t("orderDetail.fields.reference", "Reference")}</span>
            {order.reference}
          </div>
        )}
        {order.notes && (
          <div className="col-span-2">
            <span className="text-xs text-slate-500 block mb-0.5">{t("orderDetail.fields.notes", "Notes")}</span>
            {order.notes}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="px-4 py-2.5 text-left font-medium">{t("orderDetail.cols.no", "#")}</th>
                <th className="px-4 py-2.5 text-left font-medium">{t("orderDetail.cols.product", "Product")}</th>
                <th className="px-4 py-2.5 text-left font-medium">{t("orderDetail.cols.category", "Category")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t("orderDetail.cols.qtyInput", "Qty (input)")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t("orderDetail.cols.baseQty", "Base qty")}</th>
                <th className="px-4 py-2.5 text-left font-medium">{t("orderDetail.cols.notes", "Notes")}</th>
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
          {order.lines.length} {order.lines.length !== 1 ? t("transactionForm.footer.lines", "lines") : t("transactionForm.footer.line", "line")} · {order.lines.reduce((s, l) => s + l.quantity, 0)} {t("orderDetail.linesTotal", "items total")}
        </div>
      </div>
    </div>
  );
}
