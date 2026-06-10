import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateBaseBarcode,
  reserveUnitBarcodes,
  validateBarcodeUniqueness,
} from "./barcode";

// ---------------------------------------------------------------------------
// Prisma tx mock
// ---------------------------------------------------------------------------

const mockProductFindFirst = vi.fn();
const mockUnitConversionFindFirst = vi.fn();
const mockQueryRaw = vi.fn();

const tx = {
  product: {
    findFirst: mockProductFindFirst,
  },
  productUnitConversion: {
    findFirst: mockUnitConversionFindFirst,
  },
  $queryRaw: mockQueryRaw,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const txClient = tx as any;

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// generateBaseBarcode
// ---------------------------------------------------------------------------

describe("generateBaseBarcode", () => {
  it("1. returns the SKU unchanged", () => {
    expect(generateBaseBarcode("THR-00043")).toBe("THR-00043");
  });
});

// ---------------------------------------------------------------------------
// reserveUnitBarcodes
// ---------------------------------------------------------------------------

describe("reserveUnitBarcodes", () => {
  it("2. returns sequential numeric codes ending at the counter value", async () => {
    // Counter landed on 1120 after reserving 3 → codes 90001118..90001120
    mockQueryRaw.mockResolvedValue([{ value: "1120" }]);
    await expect(reserveUnitBarcodes(3, txClient)).resolves.toEqual([
      "90001118",
      "90001119",
      "90001120",
    ]);
  });

  it("3. returns a single code for count 1", async () => {
    mockQueryRaw.mockResolvedValue([{ value: "1" }]);
    await expect(reserveUnitBarcodes(1, txClient)).resolves.toEqual(["90000001"]);
  });

  it("4. returns [] without touching the DB for count 0 or negative", async () => {
    await expect(reserveUnitBarcodes(0, txClient)).resolves.toEqual([]);
    await expect(reserveUnitBarcodes(-2, txClient)).resolves.toEqual([]);
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// validateBarcodeUniqueness
// ---------------------------------------------------------------------------

describe("validateBarcodeUniqueness", () => {
  it("5. passes (no throw) when no conflicts found in either table", async () => {
    mockProductFindFirst.mockResolvedValue(null);
    mockUnitConversionFindFirst.mockResolvedValue(null);

    await expect(
      validateBarcodeUniqueness(["THR-00043", "THR-00043-BOX"], txClient)
    ).resolves.toBeUndefined();
  });

  it("6. throws when barcode exists in product.barcode", async () => {
    mockProductFindFirst.mockResolvedValue({
      barcode: "THR-00043",
      name: "Thread Roll",
    });
    mockUnitConversionFindFirst.mockResolvedValue(null);

    await expect(
      validateBarcodeUniqueness(["THR-00043"], txClient)
    ).rejects.toThrow("THR-00043");

    await expect(
      validateBarcodeUniqueness(["THR-00043"], txClient)
    ).rejects.toThrow("Thread Roll");
  });

  it("7. throws when barcode exists in productUnitConversion.barcode", async () => {
    mockProductFindFirst.mockResolvedValue(null);
    mockUnitConversionFindFirst.mockResolvedValue({
      barcode: "THR-00043-BOX",
      productId: "prod-abc",
    });

    await expect(
      validateBarcodeUniqueness(["THR-00043-BOX"], txClient)
    ).rejects.toThrow("THR-00043-BOX");

    await expect(
      validateBarcodeUniqueness(["THR-00043-BOX"], txClient)
    ).rejects.toThrow("unit conversion");
  });

  it("runs both DB checks in parallel (both findFirst called once per invocation)", async () => {
    mockProductFindFirst.mockResolvedValue(null);
    mockUnitConversionFindFirst.mockResolvedValue(null);

    await validateBarcodeUniqueness(["THR-00001"], txClient);

    expect(mockProductFindFirst).toHaveBeenCalledTimes(1);
    expect(mockUnitConversionFindFirst).toHaveBeenCalledTimes(1);
  });
});
