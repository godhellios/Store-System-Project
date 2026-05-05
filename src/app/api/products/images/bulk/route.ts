import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BULK_IMAGE_UPLOAD_ENABLED } from "@/modules/bulk-image-upload/feature-flag";
import type { BulkSaveResult, UploadSave } from "@/modules/bulk-image-upload/types";

export async function POST(req: Request) {
  if (!BULK_IMAGE_UPLOAD_ENABLED)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const saves: UploadSave[] = body.saves ?? [];

  let saved = 0;
  const errors: BulkSaveResult["errors"] = [];

  for (const { productId, url } of saves) {
    try {
      await prisma.product.update({ where: { id: productId }, data: { imageUrl: url } });
      saved++;
    } catch (err) {
      errors.push({ productId, message: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  return NextResponse.json({ saved, failed: errors.length, errors } satisfies BulkSaveResult);
}
