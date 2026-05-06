import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateBaseBarcode,
  generateUnitBarcode,
  validateBarcodeUniqueness,
} from "./barcode";

// ---------------------------------------------------------------------------
// Prisma tx mock
// ---------------------------------------------------------------------------

const mockProductFindFirst = vi.fn();
const mockUnitConversionFindFirst = vi.fn();

const tx = {
  product: {
    findFirst: mockProductFindFirst,
  },
  productUnitConversion: {
    findFirst: mockUnitConversionFindFirst,
  },
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
// generateUnitBarcode
// ---------------------------------------------------------------------------

describe("generateUnitBarcode", () => {
  it("2. returns SKU-SUFFIX when suffix is a non-empty string", () => {
    expect(generateUnitBarcode("THR-00043", "BOX")).toBe("THR-00043-BOX");
  });

  it("3. returns null when suffix is null", () => {
    expect(generateUnitBarcode("THR-00043", null)).toBeNull();
  });

  it("4. returns null when suffix is an empty string", () => {
    expect(generateUnitBarcode("THR-00043", "")).toBeNull();
  });

  it("also returns null when suffix is undefined", () => {
    expect(generateUnitBarcode("THR-00043", undefined)).toBeNull();
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
