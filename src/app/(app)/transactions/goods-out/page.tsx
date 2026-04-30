import { prisma } from "@/lib/prisma";
import { TransactionForm } from "@/components/transaction-form";
// ── whatsapp-do module ──────────────────────────────────────────────────────
import { WA_DO_PHONE_KEY, WA_DO_PHONE_DEFAULT } from "@/modules/whatsapp-do";
// ────────────────────────────────────────────────────────────────────────────

export default async function GoodsOutPage() {
  const [locations, waPhone] = await Promise.all([
    prisma.location.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    // ── whatsapp-do module ──────────────────────────────────────────────────
    prisma.systemSetting
      .findUnique({ where: { key: WA_DO_PHONE_KEY } })
      .then((r) => r?.value ?? WA_DO_PHONE_DEFAULT)
      .catch(() => WA_DO_PHONE_DEFAULT),
    // ────────────────────────────────────────────────────────────────────────
  ]);
  return (
    <div>
      <h1 className="text-base font-semibold text-slate-800 mb-5">Goods Out Order</h1>
      <TransactionForm type="GOODS_OUT" locations={locations} waPhone={waPhone} />
    </div>
  );
}
