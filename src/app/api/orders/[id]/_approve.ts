import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { sendPushNotification } from "@/modules/push-notify/send";
import { InsufficientStockError, applyGrnLineTx, applyGoodsOutLineTx, applyTransferLineTx, applyAdjustmentLineTx } from "@/lib/stock";
import { transactionBlockedBy } from "@/lib/opname-scope";
import { approvalOpnameVerdict, isStaleAgainstCount, latestApprovedCountFloor, resolveEffectiveDate } from "@/lib/effective-date";

const fmtDate = (d: Date) =>
  d.toLocaleDateString("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN")
    return NextResponse.json({ error: "Only admins can approve or reject orders" }, { status: 403 });

  const { id } = await params;
  const { action, note, lineCosts, confirm } = (await req.json()) as {
    action: "approve" | "reject";
    note?: string;
    lineCosts?: Record<string, number>;
    confirm?: boolean;
  };
  if (!["approve", "reject"].includes(action))
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  const order = await prisma.order.findUnique({ where: { id }, include: { lines: true } });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isPendingAdjustment = order.type === "ADJUSTMENT" && order.adjustmentStatus === "PENDING";
  const isPendingGrn        = order.type === "GRN"        && order.grnStatus        === "PENDING";
  const isPendingGoodsOut   = order.type === "GOODS_OUT"  && order.goodsOutStatus   === "PENDING";
  const isPendingTransfer   = order.type === "TRANSFER"   && order.transferStatus   === "PENDING";
  if (!isPendingAdjustment && !isPendingGrn && !isPendingGoodsOut && !isPendingTransfer)
    return NextResponse.json({ error: "Only pending orders can be reviewed" }, { status: 400 });

  // ── Opname guard — approve only ───────────────────────────────────────────
  // This order's date was validated when it was ENTERED, but its stock moves
  // HERE, possibly days later. Re-check both opname rules against the world as
  // it is now; see approvalOpnameVerdict() for the reasoning.
  let redateTo: Date | null = null;
  if (action === "approve") {
    const locationIds = [order.fromLocationId, order.toLocationId].filter((l): l is string => !!l);
    if (locationIds.length) {
      const [openSessions, approvedCounts, products] = await Promise.all([
        prisma.opnameSession.findMany({
          where: { locationId: { in: locationIds }, status: { in: ["IN_PROGRESS", "REVIEWING"] } },
          select: {
            id: true, sessionNumber: true, locationId: true,
            location: { select: { name: true } },
            categories: { select: { id: true, name: true } },
          },
        }),
        prisma.opnameSession.findMany({
          where: { locationId: { in: locationIds }, status: "APPROVED" },
          select: { countDate: true, approvedAt: true },
        }),
        prisma.product.findMany({
          where: { id: { in: order.lines.map((l) => l.productId) } },
          select: { categoryId: true },
        }),
      ]);

      const blocked = transactionBlockedBy(
        openSessions.map((s) => ({
          id: s.id, sessionNumber: s.sessionNumber, locationId: s.locationId,
          categoryIds: s.categories.map((c) => c.id),
        })),
        [...new Set(products.map((p) => p.categoryId).filter((c): c is string => !!c))],
      );
      const floor = latestApprovedCountFloor(approvedCounts);
      const effectiveDate = resolveEffectiveDate(order.effectiveDate, order.createdAt);
      const verdict = approvalOpnameVerdict({
        effectiveDate, floor, openCountBlocks: !!blocked, confirmed: confirm === true,
      });

      if (!verdict.ok && verdict.action === "block") {
        const s = openSessions.find((o) => o.id === blocked!.session.id)!;
        const catName = blocked!.categoryId
          ? (s.categories.find((c) => c.id === blocked!.categoryId)?.name ?? "a counted category")
          : "all categories";
        return NextResponse.json({
          error: `Cannot approve: ${s.location.name} has an open stock count (${s.sessionNumber}) covering ${catName}. Complete or cancel it first.`,
        }, { status: 409 });
      }
      if (!verdict.ok && verdict.action === "warn") {
        return NextResponse.json({
          warning: "opname",
          opnameDate: verdict.floor.toISOString(),
          opnameDateLabel: fmtDate(verdict.floor),
        }, { status: 200 });
      }
      // Confirmed override: the stock really moves now, so stamp the order and
      // its movements with this moment instead of leaving them dated behind a
      // completed count.
      if (isStaleAgainstCount(effectiveDate, floor)) redateTo = new Date();
    }
  }

  const reviewFields = {
    reviewedByName: session.user.name ?? null,
    reviewedAt: new Date(),
    reviewNote: note ?? null,
    ...(redateTo ? { effectiveDate: redateTo } : {}),
  };
  // Appended to the approval audit entry so an override is never invisible.
  const redateNote = redateTo
    ? ` — re-dated to ${fmtDate(redateTo)} (approved after a completed stock count)`
    : "";

  // ── GRN ──────────────────────────────────────────────────────────────────
  if (isPendingGrn) {
    if (action === "approve") {
      const productIds = order.lines.map((l) => l.productId);
      const inactiveProducts = await prisma.product.findMany({
        where: { id: { in: productIds }, isActive: false },
        select: { name: true, sku: true },
      });
      if (inactiveProducts.length > 0) {
        return NextResponse.json({
          error: `Cannot approve: the following products were deactivated after this GRN was submitted: ${inactiveProducts.map((p) => `"${p.name}" (${p.sku})`).join(", ")}`,
        }, { status: 400 });
      }
      if (order.toLocationId) {
        const location = await prisma.location.findUnique({
          where: { id: order.toLocationId },
          select: { name: true, isActive: true },
        });
        if (!location?.isActive) {
          return NextResponse.json({
            error: `Cannot approve: destination location${location ? ` "${location.name}"` : ""} is no longer active`,
          }, { status: 400 });
        }
      }
      await prisma.$transaction(async (tx) => {
        for (const line of order.lines) {
          if (!order.toLocationId) continue;
          const cost = lineCosts?.[line.id];
          const unitCost = cost != null && cost > 0 ? cost : undefined;
          await applyGrnLineTx(tx, line.productId, order.toLocationId, line.quantity, unitCost);
          if (unitCost != null) {
            await tx.orderLine.update({ where: { id: line.id }, data: { unitCost } });
          }
        }
        await tx.order.update({ where: { id }, data: { grnStatus: "APPROVED", ...reviewFields } });
        if (redateTo) await tx.movement.updateMany({ where: { orderId: id }, data: { effectiveDate: redateTo } });
      }, { timeout: 20000, maxWait: 15000 });
      writeAuditLog({ session, action: "APPROVE_GRN", description: `Approved ${order.orderNumber}${note ? ` — "${note}"` : ""}${redateNote}`, entityId: id, entityType: "ORDER" });
    } else {
      await prisma.order.update({ where: { id }, data: { grnStatus: "REJECTED", ...reviewFields } });
      writeAuditLog({ session, action: "REJECT_GRN", description: `Rejected ${order.orderNumber}${note ? ` — "${note}"` : ""}`, entityId: id, entityType: "ORDER" });
    }
    return NextResponse.json({ success: true });
  }

  // ── Goods Out ─────────────────────────────────────────────────────────────
  if (isPendingGoodsOut) {
    if (action === "approve") {
      try {
        await prisma.$transaction(async (tx) => {
          if (order.fromLocationId) {
            const failures: string[] = [];
            for (const line of order.lines) {
              const result = await applyGoodsOutLineTx(tx, line.productId, order.fromLocationId, line.quantity);
              if (!result.ok) failures.push(`"${result.productName}" — available: ${result.available}, requested: ${line.quantity}`);
            }
            if (failures.length) throw new InsufficientStockError(`Insufficient stock:\n${failures.join("\n")}`);
          }
          await tx.order.update({ where: { id }, data: { goodsOutStatus: "APPROVED", ...reviewFields } });
          if (redateTo) await tx.movement.updateMany({ where: { orderId: id }, data: { effectiveDate: redateTo } });
        }, { timeout: 20000, maxWait: 15000 });
      } catch (err) {
        if (err instanceof InsufficientStockError) return NextResponse.json({ error: err.message }, { status: 400 });
        console.error("Goods Out approval failed:", err);
        return NextResponse.json({ error: "Failed to approve — please try again" }, { status: 500 });
      }
      writeAuditLog({ session, action: "APPROVE_GOODS_OUT", description: `Approved ${order.orderNumber}${note ? ` — "${note}"` : ""}${redateNote}`, entityId: id, entityType: "ORDER" });
      if (order.fromLocationId) {
        prisma.stock.findMany({
          where: { productId: { in: order.lines.map((l) => l.productId) }, locationId: order.fromLocationId, product: { reorderPoint: { gt: 0 } } },
          include: { product: { select: { name: true, sku: true, reorderPoint: true } } },
        }).then((rows) => {
          const below = rows.filter((s) => s.quantity <= s.product.reorderPoint);
          if (below.length) sendPushNotification({ title: `⚠️ Low Stock Alert — ${below.length} item${below.length !== 1 ? "s" : ""} at reorder point`, body: below.map((s) => `${s.product.name} (${s.product.sku}): ${s.quantity} left`).join(", "), url: "/dashboard" });
        }).catch(() => {});
      }
    } else {
      await prisma.order.update({ where: { id }, data: { goodsOutStatus: "REJECTED", ...reviewFields } });
      writeAuditLog({ session, action: "REJECT_GOODS_OUT", description: `Rejected ${order.orderNumber}${note ? ` — "${note}"` : ""}`, entityId: id, entityType: "ORDER" });
    }
    return NextResponse.json({ success: true });
  }

  // ── Transfer ──────────────────────────────────────────────────────────────
  if (isPendingTransfer) {
    if (action === "approve") {
      try {
        await prisma.$transaction(async (tx) => {
          if (order.fromLocationId && order.toLocationId) {
            const failures: string[] = [];
            for (const line of order.lines) {
              const result = await applyTransferLineTx(tx, line.productId, order.fromLocationId, order.toLocationId, line.quantity);
              if (!result.ok) failures.push(`"${result.productName}" — available: ${result.available}, requested: ${line.quantity}`);
            }
            if (failures.length) throw new InsufficientStockError(`Insufficient stock:\n${failures.join("\n")}`);
          }
          await tx.order.update({ where: { id }, data: { transferStatus: "APPROVED", ...reviewFields } });
          if (redateTo) await tx.movement.updateMany({ where: { orderId: id }, data: { effectiveDate: redateTo } });
        }, { timeout: 20000, maxWait: 15000 });
      } catch (err) {
        if (err instanceof InsufficientStockError) return NextResponse.json({ error: err.message }, { status: 400 });
        console.error("Transfer approval failed:", err);
        return NextResponse.json({ error: "Failed to approve — please try again" }, { status: 500 });
      }
      writeAuditLog({ session, action: "APPROVE_TRANSFER", description: `Approved ${order.orderNumber}${note ? ` — "${note}"` : ""}${redateNote}`, entityId: id, entityType: "ORDER" });
      if (order.fromLocationId) {
        prisma.stock.findMany({
          where: { productId: { in: order.lines.map((l) => l.productId) }, locationId: order.fromLocationId, product: { reorderPoint: { gt: 0 } } },
          include: { product: { select: { name: true, sku: true, reorderPoint: true } } },
        }).then((rows) => {
          const below = rows.filter((s) => s.quantity <= s.product.reorderPoint);
          if (below.length) sendPushNotification({ title: `⚠️ Low Stock Alert — ${below.length} item${below.length !== 1 ? "s" : ""} at reorder point`, body: below.map((s) => `${s.product.name} (${s.product.sku}): ${s.quantity} left`).join(", "), url: "/dashboard" });
        }).catch(() => {});
      }
    } else {
      await prisma.order.update({ where: { id }, data: { transferStatus: "REJECTED", ...reviewFields } });
      writeAuditLog({ session, action: "REJECT_TRANSFER", description: `Rejected ${order.orderNumber}${note ? ` — "${note}"` : ""}`, entityId: id, entityType: "ORDER" });
    }
    return NextResponse.json({ success: true });
  }

  // ── Adjustment ────────────────────────────────────────────────────────────
  if (action === "approve") {
    try {
      await prisma.$transaction(async (tx) => {
        for (const line of order.lines) {
          if (!order.toLocationId) continue;
          await applyAdjustmentLineTx(tx, line.productId, order.toLocationId, line.quantity);
        }
        await tx.order.update({ where: { id }, data: { adjustmentStatus: "APPROVED", ...reviewFields } });
        if (redateTo) await tx.movement.updateMany({ where: { orderId: id }, data: { effectiveDate: redateTo } });
      }, { timeout: 20000, maxWait: 15000 });
    } catch (err) {
      if (err instanceof InsufficientStockError) {
        await prisma.order.update({ where: { id }, data: { adjustmentStatus: "REJECTED", ...reviewFields, reviewNote: err.message } });
        writeAuditLog({ session, action: "REJECT_ADJUSTMENT", description: `Auto-rejected ${order.orderNumber} — ${err.message}`, entityId: id, entityType: "ORDER" });
        return NextResponse.json({ error: err.message, autoRejected: true }, { status: 400 });
      }
      console.error("Adjustment approval failed:", err);
      return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to approve adjustment — please try again" }, { status: 500 });
    }
    writeAuditLog({ session, action: "APPROVE_ADJUSTMENT", description: `Approved ${order.orderNumber}${note ? ` — "${note}"` : ""}${redateNote}`, entityId: id, entityType: "ORDER" });
    if (order.toLocationId) {
      const negLines = order.lines.filter((l) => l.quantity < 0);
      if (negLines.length) {
        prisma.stock.findMany({
          where: { productId: { in: negLines.map((l) => l.productId) }, locationId: order.toLocationId, product: { reorderPoint: { gt: 0 } } },
          include: { product: { select: { name: true, sku: true, reorderPoint: true } } },
        }).then((rows) => {
          const below = rows.filter((s) => s.quantity <= s.product.reorderPoint);
          if (below.length) sendPushNotification({ title: `⚠️ Low Stock Alert — ${below.length} item${below.length !== 1 ? "s" : ""} at reorder point`, body: below.map((s) => `${s.product.name} (${s.product.sku}): ${s.quantity} left`).join(", "), url: "/dashboard" });
        }).catch(() => {});
      }
    }
  } else {
    await prisma.order.update({ where: { id }, data: { adjustmentStatus: "REJECTED", ...reviewFields } });
    writeAuditLog({ session, action: "REJECT_ADJUSTMENT", description: `Rejected ${order.orderNumber}${note ? ` — "${note}"` : ""}`, entityId: id, entityType: "ORDER" });
  }

  return NextResponse.json({ success: true });
}
