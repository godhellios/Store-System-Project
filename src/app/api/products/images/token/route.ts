import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { handleUpload } from "@vercel/blob/client";
import { BULK_IMAGE_UPLOAD_ENABLED } from "@/modules/bulk-image-upload/feature-flag";

export async function POST(req: Request) {
  if (!BULK_IMAGE_UPLOAD_ENABLED)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();

  const jsonResponse = await handleUpload({
    body,
    request: req,
    onBeforeGenerateToken: async (pathname) => {
      const ext = pathname.split(".").pop()?.toLowerCase() ?? "";
      if (!["jpg", "jpeg", "png", "webp"].includes(ext))
        throw new Error("Only JPG, PNG, WEBP allowed");
      return {
        access: "public",
        addRandomSuffix: true,
        allowedContentTypes: ["image/jpeg", "image/png", "image/webp"],
        maximumSizeInBytes: 5 * 1024 * 1024,
      };
    },
    onUploadCompleted: async () => {},
  });

  return NextResponse.json(jsonResponse);
}
