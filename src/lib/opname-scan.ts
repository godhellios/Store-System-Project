// ─────────────────────────────────────────────────────────────────────────────
// Photo Opname Scan — pure logic (no I/O, no React, no DB).
//
// Self-contained module. Reading a photographed count sheet with the Claude
// vision API, mapping the read numbers back onto opname lines. Everything here
// is deterministic and unit-tested; the API route (opname/[id]/scan) supplies
// the DB rows and the HTTP call, then delegates the shaping to these functions.
//
// To remove this feature entirely: delete this file (+ its test), the scan
// route, the panel/settings components, the printable sheet, and the guarded
// mount points. Nothing else references it.
// ─────────────────────────────────────────────────────────────────────────────

/** SystemSetting key that turns the whole feature on/off (value "1" = enabled). */
export const OPNAME_SCAN_SETTING_KEY = "opname_scan_enabled";

/** Model used for handwriting extraction. High-res vision + structured output. */
export const OPNAME_SCAN_MODEL = "claude-opus-4-8";

/** One printed row the model is told to expect, so it can anchor its reading. */
export type ScanExpectedRow = {
  row: number; // 1-based printed row number
  sku: string;
  name: string;
  unit: string;
};

/** One row as returned by the model after reading a photo. */
export type ScanResultRow = {
  row: number;
  qty: number | null; // null when the box was blank or unreadable
  unclear: boolean; // true when a digit was written but couldn't be read confidently
};

/** A confidently-read value ready to drop into the count sheet, keyed by lineId. */
export type ScanApplyRow = {
  lineId: string;
  sku: string;
  name: string;
  qty: number;
};

/** A row the admin still has to type in by hand (blank or unclear on paper). */
export type ScanUnclearRow = {
  lineId: string;
  sku: string;
  name: string;
  reason: "unclear" | "blank";
};

export type ScanPageSummary = {
  page: number | null;
  apply: ScanApplyRow[];
  unclear: ScanUnclearRow[];
  /** Row numbers the model returned that don't exist on this session (ignored). */
  unknownRows: number[];
};

// ── Prompt construction ──────────────────────────────────────────────────────

export const OPNAME_SCAN_SYSTEM_PROMPT = [
  "You transcribe handwritten stock-count sheets for a warehouse inventory system.",
  "The sheet is a printed table. Each row has a printed row number, a printed SKU and product name, and one empty box where a person wrote the counted quantity by hand.",
  "Your only job is to read the handwritten NUMBER in each row's count box. You never invent products — the products are already printed; you only read the digits.",
  "Rules:",
  "- Report the row number exactly as printed on the sheet (not the visual order).",
  "- Quantities are whole non-negative numbers. If someone wrote a decimal, round to the nearest whole number.",
  '- If a box is empty, return qty null and unclear false (nothing was written).',
  '- If a digit is written but ambiguous, smudged, crossed out, or you are not confident, return qty null and unclear TRUE. Never guess an unclear number.',
  "- Only report rows whose count box you can actually see in this photo.",
].join("\n");

/** Human-readable expected-row list appended to the user turn as anchoring context. */
export function buildScanUserText(expected: ScanExpectedRow[]): string {
  const catalog = expected
    .map((r) => `${r.row}. [${r.sku}] ${r.name} (${r.unit})`)
    .join("\n");
  return [
    "Read the handwritten count for each row in the attached photo of a stock-count sheet.",
    "The printed rows on the full sheet are listed below for reference (a single photo may show only some of them):",
    "",
    catalog,
    "",
    "Return the page number printed on the photo and, for each row you can read, its row number, the quantity, and whether it was unclear.",
  ].join("\n");
}

/**
 * JSON schema for structured output. Kept within the structured-output subset
 * (no min/max, additionalProperties:false, anyOf for nullables).
 */
export const OPNAME_SCAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    page: {
      anyOf: [{ type: "integer" }, { type: "null" }],
      description: "The page number printed on the sheet (e.g. 'Page 2 of 5' -> 2), or null if not visible.",
    },
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          row: { type: "integer", description: "Printed row number." },
          qty: {
            anyOf: [{ type: "integer" }, { type: "null" }],
            description: "Handwritten quantity, or null if blank/unclear.",
          },
          unclear: {
            type: "boolean",
            description: "True if a number was written but could not be read confidently.",
          },
        },
        required: ["row", "qty", "unclear"],
      },
    },
  },
  required: ["page", "rows"],
} as const;

// ── Response parsing / validation ────────────────────────────────────────────

/**
 * Validate and normalise the model's structured JSON into typed rows.
 * Throws on a fundamentally malformed payload; silently drops individual bad
 * rows rather than failing the whole page.
 */
export function parseScanResult(raw: unknown): { page: number | null; rows: ScanResultRow[] } {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Scan result is not an object");
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.rows)) {
    throw new Error("Scan result has no rows array");
  }

  const page = typeof obj.page === "number" && Number.isFinite(obj.page) ? Math.trunc(obj.page) : null;

  const rows: ScanResultRow[] = [];
  for (const entry of obj.rows) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.row !== "number" || !Number.isFinite(e.row)) continue;

    const unclear = e.unclear === true;
    let qty: number | null = null;
    if (typeof e.qty === "number" && Number.isFinite(e.qty)) {
      qty = Math.max(0, Math.round(e.qty)); // clamp: quantities are non-negative whole numbers
    }
    // A row flagged unclear never carries a value, even if the model returned one.
    if (unclear) qty = null;

    rows.push({ row: Math.trunc(e.row), qty, unclear });
  }
  return { page, rows };
}

// ── Mapping model rows onto opname lines ─────────────────────────────────────

/**
 * Turn validated model rows into apply/unclear buckets, keyed to real line ids.
 * `expected` defines the row-number → line mapping (built from the DB in the
 * same order the printed sheet used).
 *
 * A row is:
 *  - `apply`   when the model read a confident number (qty !== null),
 *  - `unclear` when the model flagged it (reason "unclear"),
 *  - skipped   when the box was blank (qty null, not flagged) — nothing to do,
 *  - `unknownRows` when the row number isn't in `expected` (mis-read row number).
 */
export function mapScanToLines(
  parsed: { page: number | null; rows: ScanResultRow[] },
  expected: ScanExpectedRow[],
  lineIdByRow: Record<number, string>,
): ScanPageSummary {
  const metaByRow = new Map<number, ScanExpectedRow>(expected.map((r) => [r.row, r]));
  const apply: ScanApplyRow[] = [];
  const unclear: ScanUnclearRow[] = [];
  const unknownRows: number[] = [];
  const seen = new Set<number>();

  for (const r of parsed.rows) {
    if (seen.has(r.row)) continue; // ignore duplicate row numbers from one photo
    seen.add(r.row);

    const meta = metaByRow.get(r.row);
    const lineId = lineIdByRow[r.row];
    if (!meta || !lineId) {
      unknownRows.push(r.row);
      continue;
    }
    if (r.unclear) {
      unclear.push({ lineId, sku: meta.sku, name: meta.name, reason: "unclear" });
    } else if (r.qty !== null) {
      apply.push({ lineId, sku: meta.sku, name: meta.name, qty: r.qty });
    }
    // qty null & not unclear => blank box, nothing to fill.
  }

  return { page: parsed.page, apply, unclear, unknownRows };
}
