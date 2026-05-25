import { NextResponse } from "next/server";
import bwipjs from "bwip-js";

export async function GET(_req: Request, { params }: { params: Promise<{ barcode: string }> }) {
  const { barcode } = await params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svg: string = (bwipjs as any).toSVG({
    bcid: "code128",
    text: decodeURIComponent(barcode),
    scale: 3,
    height: 15,
  });

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
