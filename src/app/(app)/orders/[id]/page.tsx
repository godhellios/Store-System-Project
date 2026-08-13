import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { notFound } from "next/navigation";
import { blockOperator } from "@/lib/role-guard";
import { OrderActions } from "@/components/order-actions";
import { GoodsOutDetailActions } from "@/components/goods-out-detail-actions";
import { LabelPrintedToggle } from "@/components/label-printed-toggle";
import { EditEffectiveDate } from "@/components/edit-effective-date";
import { ChangeWarehouse } from "@/components/change-warehouse";
import { resolveEffectiveDate } from "@/lib/effective-date";
import { packingFactorOf } from "@/lib/packing-units";
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
  const [order, waSetting, activeLocations, t] = await Promise.all([
    prisma.order.findUnique({
      where: { id },
      include: {
        fromLocation: true,
        toLocation: true,
        lines: { include: { product: { include: { category: true, unit: true, unitConversions: { select: { unit: { select: { conversionFactor: true } } } } } } }, orderBy: { id: "asc" } },
        supplierRef: true,
      },
    }),
    prisma.systemSetting.findUnique({ where: { key: "whatsapp_number" } }),
    prisma.location.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    getT(),
  ]);
  if (!order) notFound();
  const whatsappNumber = waSetting?.value ?? "6281283118487";

  // Build the same /barcodes?productId=…&copies=id:baseQty:factor URL the GRN
  // save flow produces, so labels can be (re-)printed from order history with
  // the received quantities pre-filled and split into box + pcs labels.
  let grnLabelUrl: string | null = null;
  if (order.type === "GRN" && !order.cancelledAt && order.lines.length > 0) {
    const params = new URLSearchParams();
    order.lines.forEach((l) => params.append("productId", l.productId));
    params.set("copies", order.lines.map((l) => {
      // OrderLine.quantity is base units; the factor used at entry is qty/inputQty.
      const inputFactor = l.inputQty != null && l.inputQty > 0 ? l.quantity / l.inputQty : 1;
      const packFactors = l.product.unitConversions
        .map((c) => packingFactorOf(c.unit))
        .filter((f): f is number => f !== null && f > 1);
      const factor = inputFactor > 1 ? inputFactor : (packFactors.length ? Math.min(...packFactors) : 1);
      return `${l.productId}:${l.quantity}:${factor}`;
    }).join(","));
    grnLabelUrl = `/barcodes?${params.toString()}`;
  }

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
      {order.type === "ADJUSTMENT" && order.adjustmentStatus === "PENDING" && (
        <div className="bg-amber-50 border border-amber-300 border-l-4 border-l-amber-500 rounded-xl px-4 py-3 mb-4">
          <div className="text-sm font-semibold text-amber-700">Awaiting admin approval</div>
          <div className="text-xs text-amber-600 mt-0.5">Stock will only be adjusted once an admin approves this Adjustment.</div>
        </div>
      )}
      {order.type === "ADJUSTMENT" && order.adjustmentStatus === "REJECTED" && (
        <div className="bg-red-50 border border-red-300 border-l-4 border-l-red-500 rounded-xl px-4 py-3 mb-4">
          <div className="text-sm font-semibold text-red-700">Adjustment Rejected — stock was not changed</div>
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
          {grnLabelUrl && userRole !== "VIEWER" && (
            <Link
              href={grnLabelUrl}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h1m-1 4h6m-6 4h6" />
              </svg>
              {t("orderDetail.printLabels", "Print Barcode Labels")}
            </Link>
          )}
          {order.type === "GOODS_OUT" && !order.cancelledAt && (
            <>
              {order.doSentAt && (
                <span className="text-[10px] px-2 py-1 bg-blue-100 text-blue-700 rounded-full font-medium">
                  Sent
                </span>
              )}
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
                lines={order.lines.map((l) => ({
                  quantity: l.quantity,
                  inputQty: l.inputQty,
                  inputUnit: l.inputUnit,
                  product: { name: l.product.name, unit: { name: l.product.unit.name } },
                }))}
                notes={order.notes}
                whatsappNumber={whatsappNumber}
                createdAt={order.createdAt.toISOString()}
                savedBy={order.createdByName}
                doSentAt={order.doSentAt?.toISOString() ?? null}
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
            grnLines={order.type === "GRN" ? order.lines.map((l) => ({
              id: l.id,
              productName: l.product.name,
              productSku: l.product.sku,
              quantity: l.quantity,
              unitName: l.product.unit.name,
              lastCost: l.product.lastCost ? Number(l.product.lastCost) : null,
              unitCost: l.unitCost ? Number(l.unitCost) : null,
            })) : undefined}
          />
        </div>
      </div>

      {userRole === "ADMIN" && order.type === "GRN" && (order.grnStatus === "APPROVED" || order.grnStatus === null) && !order.cancelledAt && (
        <div className="mb-4">
          <LabelPrintedToggle
            orderId={id}
            initialPrinted={order.labelPrinted}
            labelPrintedAt={order.labelPrintedAt?.toISOString() ?? null}
            labelPrintedByName={order.labelPrintedByName ?? null}
          />
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4 grid grid-cols-2 gap-4 text-sm text-gray-900">
        <div>
          <span className="text-xs text-slate-500 block mb-0.5">{t("orderDetail.fields.date", "Date")}</span>
          {resolveEffectiveDate(order.effectiveDate, order.createdAt).toLocaleString("id-ID", { dateStyle: "full", timeZone: "Asia/Jakarta" })}
          {userRole === "ADMIN" && !order.cancelledAt && (
            <div className="mt-1">
              <EditEffectiveDate
                orderId={id}
                currentEffectiveDate={resolveEffectiveDate(order.effectiveDate, order.createdAt).toISOString()}
              />
            </div>
          )}
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
        {userRole === "ADMIN" && !order.cancelledAt && (
          <div className="col-span-2">
            <ChangeWarehouse
              orderId={id}
              orderType={order.type as "GRN" | "GOODS_OUT" | "TRANSFER" | "ADJUSTMENT"}
              currentFromId={order.fromLocationId}
              currentToId={order.toLocationId}
              locations={activeLocations}
            />
          </div>
        )}
        {order.customer && (
          <div>
            <span className="text-xs text-slate-500 block mb-0.5">{t("orderDetail.fields.customer", "Customer")}</span>
            {order.customer}
          </div>
        )}
        {(order.supplierRef?.name || order.supplier) && (
          <div>
            <span className="text-xs text-slate-500 block mb-0.5">{t("orderDetail.fields.supplier", "Supplier")}</span>
            {order.supplierRef?.name ?? order.supplier}
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
                {order.type === "GRN" && (userRole === "ADMIN" || userRole === "VIEWER") && (
                  <>
                    <th className="px-4 py-2.5 text-right font-medium">Unit Cost</th>
                    <th className="px-4 py-2.5 text-right font-medium">Subtotal</th>
                  </>
                )}
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
                  {order.type === "GRN" && (userRole === "ADMIN" || userRole === "VIEWER") && (
                    <>
                      <td className="px-4 py-2.5 text-right text-xs text-slate-600">
                        {line.unitCost != null ? `Rp ${Number(line.unitCost).toLocaleString("id-ID")}` : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs font-medium text-slate-700">
                        {line.unitCost != null ? `Rp ${(Number(line.unitCost) * line.quantity).toLocaleString("id-ID")}` : <span className="text-slate-300">—</span>}
                      </td>
                    </>
                  )}
                  <td className="px-4 py-2.5 text-xs text-gray-700">{line.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-slate-100 text-xs text-slate-600 flex justify-between items-center">
          <span>{order.lines.length} {order.lines.length !== 1 ? t("transactionForm.footer.lines", "lines") : t("transactionForm.footer.line", "line")} · {order.lines.reduce((s, l) => s + l.quantity, 0)} {t("orderDetail.linesTotal", "items total")}</span>
          {order.type === "GRN" && (userRole === "ADMIN" || userRole === "VIEWER") && (() => {
            const total = order.lines.reduce((s, l) => s + (l.unitCost != null ? Number(l.unitCost) * l.quantity : 0), 0);
            const hasCost = order.lines.some((l) => l.unitCost != null);
            return hasCost ? <span className="font-semibold text-slate-700">Total: Rp {total.toLocaleString("id-ID")}</span> : <span className="text-slate-400 italic">No cost entered</span>;
          })()}
        </div>
      </div>
    </div>
  );
}
