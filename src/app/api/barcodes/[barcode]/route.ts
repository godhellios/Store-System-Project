import { NextResponse } from "next/server";
import bwipjs from "bwip-js";

export async function GET(_req: Request, { params }: { params: Promise<{ barcode: string }> }) {
  const { barcode } = await params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let svg: string = (bwipjs as any).toSVG({
    bcid: "code128",
    text: decodeURIComponent(barcode),
    scale: 3,
    height: 15,
  });

  // Keep bar edges hard (no anti-aliasing → no gray pixels) when the label is
  // rasterized for thermal printing. A 1-bit printer dithers gray edges, which
  // distorts Code128 bar-width ratios and breaks scanning. crispEdges prevents it.
  svg = svg.replace("<svg ", '<svg shape-rendering="crispEdges" ');

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
