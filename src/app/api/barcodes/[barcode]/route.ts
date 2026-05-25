import { NextResponse } from "next/server";
import bwipjs from "bwip-js";

export async function GET(_req: Request, { params }: { params: Promise<{ barcode: string }> }) {
  const { barcode } = await params;

  const svg = bwipjs.toSVG({
    bcid: "code128",
    text: decodeURIComponent(barcode),
    scale: 3,
    height: 15,
    includetext: false,
  });

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
