// ─────────────────────────────────────────────────────────────────────────────
// Photo Opname Scan — API route.  POST /api/opname/[id]/scan
//
// Admin-only. Accepts ONE page photo, archives it to Vercel Blob, sends it to
// the Claude vision API with the session's expected rows, and returns the read
// quantities mapped back onto opname line ids. Writes NOTHING to stock — the
// client merges the result into the count-sheet draft, which still goes through
// the normal submit → review → approve flow.
//
// Feature flag: returns 404 unless SystemSetting `opname_scan_enabled` === "1".
// Requires env ANTHROPIC_API_KEY. Uses raw fetch (no SDK dependency) so the
// module stays fully self-contained and deletable.
// ─────────────────────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { put } from "@vercel/blob";
import {
  OPNAME_SCAN_SETTING_KEY,
  OPNAME_SCAN_MODEL,
  OPNAME_SCAN_SYSTEM_PROMPT,
  OPNAME_SCAN_JSON_SCHEMA,
  buildScanUserText,
  parseScanResult,
  mapScanToLines,
  type ScanExpectedRow,
} from "@/lib/opname-scan";

export const maxDuration = 60; // vision calls take ~5–15s per page

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MEDIA_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN")
    return NextResponse.json({ error: "Admin only" }, { status: 403 });

  // Feature flag — the whole route is invisible when disabled.
  const flag = await prisma.systemSetting
    .findUnique({ where: { key: OPNAME_SCAN_SETTING_KEY } })
    .catch(() => null);
  if (flag?.value !== "1")
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey)
    return NextResponse.json(
      { error: "Photo scanning is not configured (missing ANTHROPIC_API_KEY)." },
      { status: 503 },
    );

  const { id } = await params;

  // Validate the uploaded image.
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No photo provided" }, { status: 400 });
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mediaType = MEDIA_TYPES[ext];
  if (!mediaType)
    return NextResponse.json({ error: "Only JPG, PNG, WEBP or GIF photos allowed" }, { status: 400 });
  if (file.size > 10 * 1024 * 1024)
    return NextResponse.json({ error: "Photo must be under 10 MB" }, { status: 400 });

  // Load the session's lines in the SAME order the printed sheet uses (name asc).
  // Row number = index + 1. The printed sheet and this query MUST stay in sync.
  const opnameSession = await prisma.opnameSession.findUnique({
    where: { id },
    select: {
      status: true,
      lines: {
        select: { id: true, product: { select: { sku: true, name: true, unit: { select: { name: true } } } } },
        orderBy: { product: { name: "asc" } },
      },
    },
  });
  if (!opnameSession) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (opnameSession.status !== "IN_PROGRESS")
    return NextResponse.json({ error: "This session is not open for counting." }, { status: 409 });
  if (opnameSession.lines.length === 0)
    return NextResponse.json({ error: "This session has no items." }, { status: 400 });

  const expected: ScanExpectedRow[] = opnameSession.lines.map((l, i) => ({
    row: i + 1,
    sku: l.product.sku,
    name: l.product.name,
    unit: l.product.unit?.name ?? "",
  }));
  const lineIdByRow: Record<number, string> = {};
  opnameSession.lines.forEach((l, i) => { lineIdByRow[i + 1] = l.id; });

  // Archive the photo (audit trail + so the admin can check reads against it).
  const bytes = Buffer.from(await file.arrayBuffer());
  let photoUrl: string | null = null;
  try {
    const blob = await put(
      `opname-scans/${id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`,
      bytes,
      { access: "public", contentType: mediaType },
    );
    photoUrl = blob.url;
  } catch {
    // Archiving is best-effort — don't block extraction if Blob is unavailable.
    photoUrl = null;
  }

  // Call the Claude vision API (raw HTTP, structured JSON output).
  let modelJson: unknown;
  try {
    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: OPNAME_SCAN_MODEL,
        max_tokens: 8192,
        system: OPNAME_SCAN_SYSTEM_PROMPT,
        output_config: { format: { type: "json_schema", schema: OPNAME_SCAN_JSON_SCHEMA } },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: bytes.toString("base64") } },
              { type: "text", text: buildScanUserText(expected) },
            ],
          },
        ],
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      console.error("[opname-scan] Claude API error", resp.status, detail.slice(0, 500));
      const msg = resp.status === 429
        ? "The photo reader is busy. Wait a moment and retry this page."
        : "The photo reader could not process this page. Retry, or enter the numbers by hand.";
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    const data = await resp.json();
    if (data.stop_reason === "refusal") {
      return NextResponse.json(
        { error: "The photo reader declined this image. Enter the numbers by hand." },
        { status: 502 },
      );
    }
    const textBlock = Array.isArray(data.content)
      ? data.content.find((b: { type?: string }) => b.type === "text")
      : null;
    if (!textBlock?.text) throw new Error("No text block in model response");
    modelJson = JSON.parse(textBlock.text);
  } catch (err) {
    console.error("[opname-scan] extraction failed", err);
    return NextResponse.json(
      { error: "Could not read this page. Retry, or enter the numbers by hand." },
      { status: 502 },
    );
  }

  // Shape the result (pure, tested).
  let summary;
  try {
    summary = mapScanToLines(parseScanResult(modelJson), expected, lineIdByRow);
  } catch (err) {
    console.error("[opname-scan] parse failed", err);
    return NextResponse.json(
      { error: "The photo reader returned an unexpected result. Retry this page." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    photoUrl,
    page: summary.page,
    filledCount: summary.apply.length,
    unclearCount: summary.unclear.length,
    apply: summary.apply,
    unclear: summary.unclear,
    totalRows: expected.length,
  });
}
