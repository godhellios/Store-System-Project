import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  calcAvco,
  isSufficient,
  calcNewQty,
  InsufficientStockError,
  applyGrnLineTx,
  applyGoodsOutLineTx,
  applyTransferLineTx,
  applyAdjustmentLineTx,
} from "./stock";

// ── Pure: calcAvco ───────────────────────────────────────────────────────────

describe("calcAvco", () => {
  it("first receipt (qtyBefore=0): avgCost equals the receipt cost", () => {
    expect(calcAvco(0, 0, 100, 5000)).toBe(5000);
  });

  it("second receipt: produces correct weighted average", () => {
    // 100 units @ 5000, then 50 units @ 4000 → (500000 + 200000) / 150 ≈ 4666.67
    expect(calcAvco(5000, 100, 50, 4000)).toBeCloseTo(4666.67, 1);
  });

  it("large existing qty: small new receipt barely moves the average", () => {
    // 1000 @ 10000 + 1 @ 1000 → (10000000 + 1000) / 1001 ≈ 9991.01
    expect(calcAvco(10000, 1000, 1, 1000)).toBeCloseTo(9991.01, 1);
  });

  it("same cost for both receipts: average stays the same", () => {
    expect(calcAvco(8000, 200, 50, 8000)).toBe(8000);
  });
});

// ── Pure: isSufficient ───────────────────────────────────────────────────────

describe("isSufficient", () => {
  it("exact match returns true", () => {
    expect(isSufficient(10, 10)).toBe(true);
  });

  it("more available than requested returns true", () => {
    expect(isSufficient(20, 10)).toBe(true);
  });

  it("less available than requested returns false", () => {
    expect(isSufficient(5, 10)).toBe(false);
  });

  it("zero available with non-zero request returns false", () => {
    expect(isSufficient(0, 1)).toBe(false);
  });
});

// ── Pure: calcNewQty ─────────────────────────────────────────────────────────

describe("calcNewQty", () => {
  it("positive delta increases qty", () => {
    expect(calcNewQty(50, 10)).toBe(60);
  });

  it("negative delta within available decreases qty", () => {
    expect(calcNewQty(50, -10)).toBe(40);
  });

  it("negative delta zeroing stock returns 0", () => {
    expect(calcNewQty(10, -10)).toBe(0);
  });

  it("negative delta below zero returns negative (caller decides whether to reject)", () => {
    expect(calcNewQty(5, -10)).toBe(-5);
  });
});

// ── Tx: applyGrnLineTx ───────────────────────────────────────────────────────

describe("applyGrnLineTx", () => {
  let mockUpsert: ReturnType<typeof vi.fn>;
  let mockFindUniqueProduct: ReturnType<typeof vi.fn>;
  let mockAggregate: ReturnType<typeof vi.fn>;
  let mockUpdateProduct: ReturnType<typeof vi.fn>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;

  beforeEach(() => {
    mockUpsert = vi.fn().mockResolvedValue({});
    mockFindUniqueProduct = vi.fn().mockResolvedValue({ avgCost: null });
    mockAggregate = vi.fn().mockResolvedValue({ _sum: { quantity: 50 } });
    mockUpdateProduct = vi.fn().mockResolvedValue({});
    tx = {
      stock: { upsert: mockUpsert, aggregate: mockAggregate },
      product: { findUnique: mockFindUniqueProduct, update: mockUpdateProduct },
    };
  });

  it("upserts stock for the receiving location", async () => {
    await applyGrnLineTx(tx, "prod-1", "loc-1", 50);
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { productId_locationId: { productId: "prod-1", locationId: "loc-1" } },
      create: { productId: "prod-1", locationId: "loc-1", quantity: 50 },
      update: { quantity: { increment: 50 } },
    });
  });

  it("does not update product cost when cost is undefined", async () => {
    await applyGrnLineTx(tx, "prod-1", "loc-1", 50);
    expect(mockUpdateProduct).not.toHaveBeenCalled();
  });

  it("does not update product cost when cost is 0", async () => {
    await applyGrnLineTx(tx, "prod-1", "loc-1", 50, 0);
    expect(mockUpdateProduct).not.toHaveBeenCalled();
  });

  it("first receipt (qtyBefore=0): sets avgCost equal to receipt cost", async () => {
    // aggregate returns exactly the quantity just received (no prior stock anywhere)
    mockAggregate.mockResolvedValue({ _sum: { quantity: 50 } });
    mockFindUniqueProduct.mockResolvedValue({ avgCost: null });
    await applyGrnLineTx(tx, "prod-1", "loc-1", 50, 8000);
    expect(mockUpdateProduct).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastCost: 8000, avgCost: 8000 }) })
    );
  });

  it("subsequent receipt: AVCO is weighted across all locations", async () => {
    // Total stock after upsert = 150 (100 existing across all locations + 50 new)
    mockAggregate.mockResolvedValue({ _sum: { quantity: 150 } });
    mockFindUniqueProduct.mockResolvedValue({ avgCost: "5000" });
    await applyGrnLineTx(tx, "prod-1", "loc-1", 50, 4000);
    // qtyBefore = 150 - 50 = 100; newAvg = (100*5000 + 50*4000)/150 ≈ 4666.67
    const call = mockUpdateProduct.mock.calls[0][0];
    expect(Number(call.data.avgCost)).toBeCloseTo(4666.67, 1);
  });
});

// ── Tx: applyGoodsOutLineTx ──────────────────────────────────────────────────

describe("applyGoodsOutLineTx", () => {
  let mockExecuteRaw: ReturnType<typeof vi.fn>;
  let mockFindUniqueStock: ReturnType<typeof vi.fn>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;

  beforeEach(() => {
    mockExecuteRaw = vi.fn().mockResolvedValue(1);
    mockFindUniqueStock = vi.fn().mockResolvedValue({ quantity: 0, product: { name: "Unknown" } });
    tx = { $executeRaw: mockExecuteRaw, stock: { findUnique: mockFindUniqueStock } };
  });

  it("returns { ok: true } when stock is sufficient", async () => {
    mockExecuteRaw.mockResolvedValue(1);
    const result = await applyGoodsOutLineTx(tx, "prod-1", "loc-1", 10);
    expect(result).toEqual({ ok: true });
  });

  it("returns { ok: false } with product name when stock is insufficient", async () => {
    mockExecuteRaw.mockResolvedValue(0);
    mockFindUniqueStock.mockResolvedValue({ quantity: 5, product: { name: "Thread Roll" } });
    const result = await applyGoodsOutLineTx(tx, "prod-1", "loc-1", 10);
    expect(result).toEqual({ ok: false, productName: "Thread Roll", available: 5 });
  });

  it("returns { ok: false } when no stock row exists (available = 0)", async () => {
    mockExecuteRaw.mockResolvedValue(0);
    mockFindUniqueStock.mockResolvedValue(null);
    const result = await applyGoodsOutLineTx(tx, "prod-1", "loc-1", 10);
    expect(result).toEqual({ ok: false, productName: "prod-1", available: 0 });
  });

  it("returns { ok: true } when requested qty exactly matches available", async () => {
    mockExecuteRaw.mockResolvedValue(1);
    const result = await applyGoodsOutLineTx(tx, "prod-1", "loc-1", 10);
    expect(result).toEqual({ ok: true });
  });
});

// ── Tx: applyTransferLineTx ──────────────────────────────────────────────────

describe("applyTransferLineTx", () => {
  let mockExecuteRaw: ReturnType<typeof vi.fn>;
  let mockFindUniqueStock: ReturnType<typeof vi.fn>;
  let mockUpsertStock: ReturnType<typeof vi.fn>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;

  beforeEach(() => {
    mockExecuteRaw = vi.fn().mockResolvedValue(1);
    mockFindUniqueStock = vi.fn().mockResolvedValue({ quantity: 5, product: { name: "Test" } });
    mockUpsertStock = vi.fn().mockResolvedValue({});
    tx = { $executeRaw: mockExecuteRaw, stock: { findUnique: mockFindUniqueStock, upsert: mockUpsertStock } };
  });

  it("returns { ok: true } and upserts destination when source has enough", async () => {
    const result = await applyTransferLineTx(tx, "prod-1", "from-loc", "to-loc", 20);
    expect(result).toEqual({ ok: true });
    expect(mockUpsertStock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId_locationId: { productId: "prod-1", locationId: "to-loc" } },
      })
    );
  });

  it("returns { ok: false } and does NOT upsert destination when source is insufficient", async () => {
    mockExecuteRaw.mockResolvedValue(0);
    mockFindUniqueStock.mockResolvedValue({ quantity: 5, product: { name: "Thread Roll" } });
    const result = await applyTransferLineTx(tx, "prod-1", "from-loc", "to-loc", 20);
    expect(result).toEqual({ ok: false, productName: "Thread Roll", available: 5 });
    expect(mockUpsertStock).not.toHaveBeenCalled();
  });

  it("creates destination stock row when it does not exist", async () => {
    await applyTransferLineTx(tx, "prod-1", "from-loc", "to-loc", 30);
    expect(mockUpsertStock).toHaveBeenCalledWith(
      expect.objectContaining({ create: { productId: "prod-1", locationId: "to-loc", quantity: 30 } })
    );
  });

  it("increments destination stock when it already exists", async () => {
    await applyTransferLineTx(tx, "prod-1", "from-loc", "to-loc", 15);
    expect(mockUpsertStock).toHaveBeenCalledWith(
      expect.objectContaining({ update: { quantity: { increment: 15 } } })
    );
  });
});

// ── Tx: applyAdjustmentLineTx ────────────────────────────────────────────────

describe("applyAdjustmentLineTx", () => {
  let mockFindUniqueStock: ReturnType<typeof vi.fn>;
  let mockFindUniqueProduct: ReturnType<typeof vi.fn>;
  let mockUpdateStock: ReturnType<typeof vi.fn>;
  let mockCreateStock: ReturnType<typeof vi.fn>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;

  beforeEach(() => {
    mockFindUniqueStock = vi.fn().mockResolvedValue({ quantity: 50 });
    mockFindUniqueProduct = vi.fn().mockResolvedValue({ name: "Product A", sku: "SKU-001" });
    mockUpdateStock = vi.fn().mockResolvedValue({});
    mockCreateStock = vi.fn().mockResolvedValue({});
    tx = {
      stock: { findUnique: mockFindUniqueStock, update: mockUpdateStock, create: mockCreateStock },
      product: { findUnique: mockFindUniqueProduct },
    };
  });

  it("positive delta on existing stock: increments correctly", async () => {
    mockFindUniqueStock.mockResolvedValue({ quantity: 50 });
    await applyAdjustmentLineTx(tx, "prod-1", "loc-1", 20);
    expect(mockUpdateStock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { quantity: 70 } })
    );
  });

  it("negative delta within available: decrements correctly", async () => {
    mockFindUniqueStock.mockResolvedValue({ quantity: 50 });
    await applyAdjustmentLineTx(tx, "prod-1", "loc-1", -20);
    expect(mockUpdateStock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { quantity: 30 } })
    );
  });

  it("negative delta exactly zeroing stock: sets quantity to 0", async () => {
    mockFindUniqueStock.mockResolvedValue({ quantity: 20 });
    await applyAdjustmentLineTx(tx, "prod-1", "loc-1", -20);
    expect(mockUpdateStock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { quantity: 0 } })
    );
  });

  it("negative delta below zero: throws InsufficientStockError", async () => {
    mockFindUniqueStock.mockResolvedValue({ quantity: 5 });
    await expect(applyAdjustmentLineTx(tx, "prod-1", "loc-1", -10)).rejects.toThrow(
      InsufficientStockError
    );
  });

  it("no existing stock row + positive delta: creates new stock row", async () => {
    mockFindUniqueStock.mockResolvedValue(null);
    await applyAdjustmentLineTx(tx, "prod-1", "loc-1", 30);
    expect(mockCreateStock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { productId: "prod-1", locationId: "loc-1", quantity: 30 } })
    );
    expect(mockUpdateStock).not.toHaveBeenCalled();
  });

  it("no existing stock row + negative delta: throws InsufficientStockError", async () => {
    mockFindUniqueStock.mockResolvedValue(null);
    await expect(applyAdjustmentLineTx(tx, "prod-1", "loc-1", -5)).rejects.toThrow(
      InsufficientStockError
    );
  });

  it("error message includes product name", async () => {
    mockFindUniqueStock.mockResolvedValue({ quantity: 5 });
    mockFindUniqueProduct.mockResolvedValue({ name: "Thread Roll", sku: "THR-00001" });
    await expect(applyAdjustmentLineTx(tx, "prod-1", "loc-1", -10)).rejects.toThrow("Thread Roll");
  });
});
