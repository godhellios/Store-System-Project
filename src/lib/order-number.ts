import { prisma } from "@/lib/prisma";

const PREFIX: Record<string, string> = {
  GRN: "GRN",
  GOODS_OUT: "OUT",
  TRANSFER: "TRF",
  ADJUSTMENT: "ADJ",
};

export async function nextOrderNumber(type: string): Promise<string> {
  const prefix = PREFIX[type] ?? "ORD";
  const year = new Date().getFullYear();
  const last = await prisma.order.findFirst({
    where: { orderNumber: { startsWith: `${prefix}-${year}-` } },
    orderBy: { orderNumber: "desc" },
    select: { orderNumber: true },
  });
  const lastNum = last ? parseInt(last.orderNumber.split("-").pop() ?? "0") : 0;
  return `${prefix}-${year}-${String(lastNum + 1).padStart(4, "0")}`;
}
