import { describe, it, expect } from "vitest";
import {
  parseScanResult,
  mapScanToLines,
  buildScanUserText,
  OPNAME_SCAN_JSON_SCHEMA,
  type ScanExpectedRow,
} from "./opname-scan";

const expected: ScanExpectedRow[] = [
  { row: 1, sku: "SKU-A", name: "Batok 18 2L", unit: "pcs" },
  { row: 2, sku: "SKU-B", name: "Minyak 1L", unit: "btl" },
  { row: 3, sku: "SKU-C", name: "Beras 5kg", unit: "sak" },
];
const lineIdByRow = { 1: "line-a", 2: "line-b", 3: "line-c" };

describe("parseScanResult", () => {
  it("parses well-formed rows and page number", () => {
    const out = parseScanResult({
      page: 2,
      rows: [
        { row: 1, qty: 12, unclear: false },
        { row: 2, qty: null, unclear: false },
        { row: 3, qty: null, unclear: true },
      ],
    });
    expect(out.page).toBe(2);
    expect(out.rows).toHaveLength(3);
    expect(out.rows[0]).toEqual({ row: 1, qty: 12, unclear: false });
  });

  it("clamps negative and rounds decimal quantities", () => {
    const out = parseScanResult({ page: null, rows: [
      { row: 1, qty: -5, unclear: false },
      { row: 2, qty: 3.6, unclear: false },
    ] });
    expect(out.rows[0].qty).toBe(0);
    expect(out.rows[1].qty).toBe(4);
  });

  it("forces qty to null when a row is flagged unclear even if a number was returned", () => {
    const out = parseScanResult({ page: 1, rows: [{ row: 1, qty: 8, unclear: true }] });
    expect(out.rows[0]).toEqual({ row: 1, qty: null, unclear: true });
  });

  it("drops malformed individual rows without failing the page", () => {
    const out = parseScanResult({ page: 1, rows: [
      { row: 1, qty: 5, unclear: false },
      { qty: 9, unclear: false }, // no row number
      "garbage",
      null,
    ] });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].row).toBe(1);
  });

  it("throws on fundamentally malformed payloads", () => {
    expect(() => parseScanResult(null)).toThrow();
    expect(() => parseScanResult({ page: 1 })).toThrow(); // no rows array
    expect(() => parseScanResult("nope")).toThrow();
  });

  it("treats a non-numeric page as null", () => {
    expect(parseScanResult({ page: "2", rows: [] }).page).toBeNull();
  });
});

describe("mapScanToLines", () => {
  it("routes confident reads to apply and flagged reads to unclear", () => {
    const parsed = parseScanResult({ page: 3, rows: [
      { row: 1, qty: 12, unclear: false },
      { row: 2, qty: null, unclear: true },
      { row: 3, qty: null, unclear: false }, // blank box -> skipped
    ] });
    const out = mapScanToLines(parsed, expected, lineIdByRow);
    expect(out.page).toBe(3);
    expect(out.apply).toEqual([{ lineId: "line-a", sku: "SKU-A", name: "Batok 18 2L", qty: 12 }]);
    expect(out.unclear).toEqual([{ lineId: "line-b", sku: "SKU-B", name: "Minyak 1L", reason: "unclear" }]);
    expect(out.unknownRows).toEqual([]);
  });

  it("collects row numbers not present in the session as unknown", () => {
    const parsed = parseScanResult({ page: 1, rows: [{ row: 99, qty: 4, unclear: false }] });
    const out = mapScanToLines(parsed, expected, lineIdByRow);
    expect(out.apply).toHaveLength(0);
    expect(out.unknownRows).toEqual([99]);
  });

  it("ignores duplicate row numbers from a single photo", () => {
    const parsed = parseScanResult({ page: 1, rows: [
      { row: 1, qty: 5, unclear: false },
      { row: 1, qty: 9, unclear: false },
    ] });
    const out = mapScanToLines(parsed, expected, lineIdByRow);
    expect(out.apply).toHaveLength(1);
    expect(out.apply[0].qty).toBe(5); // first wins
  });

  it("never fills a blank box", () => {
    const parsed = parseScanResult({ page: 1, rows: [{ row: 2, qty: null, unclear: false }] });
    const out = mapScanToLines(parsed, expected, lineIdByRow);
    expect(out.apply).toHaveLength(0);
    expect(out.unclear).toHaveLength(0);
  });
});

describe("buildScanUserText", () => {
  it("lists every expected row with sku, name and unit", () => {
    const text = buildScanUserText(expected);
    expect(text).toContain("1. [SKU-A] Batok 18 2L (pcs)");
    expect(text).toContain("3. [SKU-C] Beras 5kg (sak)");
  });
});

describe("OPNAME_SCAN_JSON_SCHEMA", () => {
  it("stays within the structured-output subset (additionalProperties false, required set)", () => {
    expect(OPNAME_SCAN_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(OPNAME_SCAN_JSON_SCHEMA.required).toContain("rows");
    const rowItem = OPNAME_SCAN_JSON_SCHEMA.properties.rows.items;
    expect(rowItem.additionalProperties).toBe(false);
    expect(rowItem.required).toEqual(["row", "qty", "unclear"]);
  });
});
