import { NextResponse } from "next/server";
import bwipjs from "bwip-js";

export async function GET(req: Request, { params }: { params: Promise<{ barcode: string }> }) {
  const { barcode } = await params;
  const text = decodeURIComponent(barcode);
  const { searchParams } = new URL(req.url);

  // PNG variant for label PRINTING (?fmt=png&maxw=<px>): rendered at a whole
  // number of pixels per barcode module so that, printed 1:1 at the printer's
  // resolution, every bar is a whole number of dots — the driver can't round
  // bar widths unevenly, which is what made printed labels unscannable.
  // `maxw` is the widest the barcode may be in printer dots; we pick the largest
  // integer scale that fits.
  if (searchParams.get("fmt") === "png") {
    const maxw = parseInt(searchParams.get("maxw") ?? "0", 10);
    const opts = { bcid: "code128", text, height: 12, includetext: false };

    // Probe at scale 1 to learn the module count (PNG width = modules at scale 1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const probe: Buffer = await (bwipjs as any).toBuffer({ ...opts, scale: 1 });
    const modules = probe.readUInt32BE(16); // PNG IHDR width
    const scale = Math.min(6, Math.max(1, maxw > 0 ? Math.floor(maxw / modules) : 2));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const png: Buffer = await (bwipjs as any).toBuffer({ ...opts, scale });
    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  // Default: SVG for on-screen display (barcodes page, scan test, print preview)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let svg: string = (bwipjs as any).toSVG({
    bcid: "code128",
    text,
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
