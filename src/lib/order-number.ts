import { prisma } from "@/lib/prisma";

const PREFIX: Record<string, string> = {
  GRN: "GRN",
  GOODS_OUT: "OUT",
  TRANSFER: "TRF",
  ADJUSTMENT: "ADJ",
};

// Atomic counter via SystemSetting row — safe under concurrent requests.
// Key format: order_seq_<PREFIX>_<YEAR> — resets naturally each year via new key.
export async function nextOrderNumber(type: string): Promise<string> {
  const prefix = PREFIX[type] ?? "ORD";
  const year = new Date().getFullYear();
  const key = `order_seq_${prefix}_${year}`;

  const result = await prisma.$queryRaw<Array<{ value: string }>>`
    INSERT INTO "SystemSetting" (key, value, "updatedAt")
    VALUES (${key}, '1', NOW())
    ON CONFLICT (key) DO UPDATE
      SET value       = (CAST("SystemSetting".value AS BIGINT) + 1)::text,
          "updatedAt" = NOW()
    RETURNING value
  `;

  const num = parseInt(result[0].value);
  return `${prefix}-${year}-${String(num).padStart(4, "0")}`;
}
