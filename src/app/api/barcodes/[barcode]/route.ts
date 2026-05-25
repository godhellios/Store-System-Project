import { NextResponse } from "next/server";
import bwipjs from "bwip-js";

export async function GET(req: Request, { params }: { params: Promise<{ barcode: string }> }) {

  const { barcode } = await params;

  const png = await bwipjs.toBuffer({
    bcid: "code128",
    text: decodeURIComponent(barcode),
    scale: 2,
    height: 10,
    includetext: true,
    textxalign: "center",
  });

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
