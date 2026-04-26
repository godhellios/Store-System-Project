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
  const count = await prisma.order.count({
    where: { orderNumber: { startsWith: `${prefix}-${year}-` } },
  });
  return `${prefix}-${year}-${String(count + 1).padStart(4, "0")}`;
}
