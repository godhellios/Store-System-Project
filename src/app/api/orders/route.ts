import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MovementType, OrderType } from "@/generated/prisma";

const ORDER_PREFIX: Record<string, string> = {
  GRN: "GRN", GOODS_OUT: "OUT", TRANSFER: "TRF", ADJUSTMENT: "ADJ",
};

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") as OrderType | null;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const perPage = 20;

  const where = { ...(type ? { type } : {}) };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      include: {
        fromLocation: true,
        toLocation: true,
        _count: { select: { lines: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);

  return NextResponse.json({ orders, total, page, pages: Math.ceil(total / perPage) });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { type, fromLocationId, toLocationId, reference, notes, lines } = body as {
    type: OrderType;
    fromLocationId?: string;
    toLocationId?: string;
    reference?: string;
    notes?: string;
    lines: Array<{ productId: string; quantity: number; notes?: string }>;
  };

  if (!type) return NextResponse.json({ error: "Type is required" }, { status: 400 });
  if (!lines?.length) return NextResponse.json({ error: "At least one line is required" }, { status: 400 });
  if ((type === "GRN" || type === "ADJUSTMENT") && !toLocationId)
    return NextResponse.json({ error: "Destination location is required" }, { status: 400 });
  if (type === "GOODS_OUT" && !fromLocationId)
    return NextResponse.json({ error: "Source location is required" }, { status: 400 });
  if (type === "TRANSFER" && (!fromLocationId || !toLocationId))
    return NextResponse.json({ error: "Both source and destination locations are required" }, { status: 400 });

  if (type === "GRN") {
    const productIds = lines.map((l) => l.productId);
    const inactive = await prisma.product.findMany({
      where: { id: { in: productIds }, isActive: false },
      select: { name: true },
    });
    if (inactive.length > 0)
      return NextResponse.json(
        { error: `Cannot receive deactivated product(s): ${inactive.map((p) => p.name).join(", ")}` },
        { status: 400 }
      );
  }

  const MOVEMENT_TYPE: Record<OrderType, MovementType> = {
    GRN: MovementType.IN,
    GOODS_OUT: MovementType.OUT,
    TRANSFER: MovementType.TRANSFER,
    ADJUSTMENT: MovementType.ADJUSTMENT,
  };

  const warnings: string[] = [];

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const prefix = ORDER_PREFIX[type] ?? "ORD";
      const year = new Date().getFullYear();
      const last = await tx.order.findFirst({
        where: { orderNumber: { startsWith: `${prefix}-${year}-` } },
        orderBy: { orderNumber: "desc" },
        select: { orderNumber: true },
      });
      const lastNum = last ? parseInt(last.orderNumber.split("-").pop() ?? "0") : 0;
      const orderNumber = `${prefix}-${year}-${String(lastNum + 1).padStart(4, "0")}`;

      const order = await tx.order.create({
        data: { orderNumber, type, fromLocationId, toLocationId, reference, notes },
      });

      for (const line of lines) {
        const orderLine = await tx.orderLine.create({
          data: { orderId: order.id, productId: line.productId, quantity: line.quantity, notes: line.notes },
        });

        await tx.movement.create({
          data: {
            orderId: order.id,
            orderLineId: orderLine.id,
            productId: line.productId,
            fromLocationId: fromLocationId ?? null,
            toLocationId: toLocationId ?? null,
            quantity: line.quantity,
            type: MOVEMENT_TYPE[type],
          },
        });

        if (type === "GRN") {
          await tx.stock.upsert({
            where: { productId_locationId: { productId: line.productId, locationId: toLocationId! } },
            create: { productId: line.productId, locationId: toLocationId!, quantity: line.quantity },
            update: { quantity: { increment: line.quantity } },
          });
        } else if (type === "GOODS_OUT") {
          const current = await tx.stock.findUnique({
            where: { productId_locationId: { productId: line.productId, locationId: fromLocationId! } },
            include: { product: true },
          });
          const newQty = (current?.quantity ?? 0) - line.quantity;
          if (newQty < 0) warnings.push(`⚠ ${current?.product.name ?? line.productId}: stock went negative (${newQty})`);
          await tx.stock.upsert({
            where: { productId_locationId: { productId: line.productId, locationId: fromLocationId! } },
            create: { productId: line.productId, locationId: fromLocationId!, quantity: -line.quantity },
            update: { quantity: { decrement: line.quantity } },
          });
        } else if (type === "TRANSFER") {
          const current = await tx.stock.findUnique({
            where: { productId_locationId: { productId: line.productId, locationId: fromLocationId! } },
            include: { product: true },
          });
          const newQty = (current?.quantity ?? 0) - line.quantity;
          if (newQty < 0) warnings.push(`⚠ ${current?.product.name ?? line.productId}: source stock went negative (${newQty})`);
          await tx.stock.upsert({
            where: { productId_locationId: { productId: line.productId, locationId: fromLocationId! } },
            create: { productId: line.productId, locationId: fromLocationId!, quantity: -line.quantity },
            update: { quantity: { decrement: line.quantity } },
          });
          await tx.stock.upsert({
            where: { productId_locationId: { productId: line.productId, locationId: toLocationId! } },
            create: { productId: line.productId, locationId: toLocationId!, quantity: line.quantity },
            update: { quantity: { increment: line.quantity } },
          });
        } else if (type === "ADJUSTMENT") {
          await tx.stock.upsert({
            where: { productId_locationId: { productId: line.productId, locationId: toLocationId! } },
            create: { productId: line.productId, locationId: toLocationId!, quantity: line.quantity },
            update: { quantity: { increment: line.quantity } },
          });
        }
      }

      return order;
    });
  } catch (err) {
    console.error("Order creation failed:", err);
    return NextResponse.json({ error: "Failed to create order — please try again" }, { status: 500 });
  }

  return NextResponse.json({ order: result, warnings }, { status: 201 });
}
