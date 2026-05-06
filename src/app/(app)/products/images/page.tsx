import { notFound } from "next/navigation";
import { BULK_IMAGE_UPLOAD_ENABLED } from "@/modules/bulk-image-upload/feature-flag";
import { blockOperator } from "@/lib/role-guard";
import { prisma } from "@/lib/prisma";
import { BulkImageUploadClient } from "./_client";

export default async function BulkImageUploadPage() {
  if (!BULK_IMAGE_UPLOAD_ENABLED) notFound();
  await blockOperator();

  const products = await prisma.product.findMany({
    where: { isActive: true, OR: [{ approvalStatus: "ACTIVE" }, { approvalStatus: null }] },
    select: { id: true, sku: true, name: true, imageUrl: true },
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <h1 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-5">
        Bulk Image Upload
      </h1>
      <BulkImageUploadClient products={products} />
    </div>
  );
}
