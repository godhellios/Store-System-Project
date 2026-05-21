import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyOpeningCost, applyCorrectCost, OpeningCostError } from "./opening-cost";

// ── applyOpeningCost ─────────────────────────────────────────────────────────
// Sets avgCost + lastCost only when product currently has no cost (avgCost IS NULL)

describe("applyOpeningCost", () => {
  let mockFindUnique: ReturnType<typeof vi.fn>;
  let mockUpdate: ReturnType<typeof vi.fn>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;

  beforeEach(() => {
    mockFindUnique = vi.fn();
    mockUpdate = vi.fn().mockResolvedValue({});
    tx = {
      product: { findUnique: mockFindUnique, update: mockUpdate },
    };
  });

  it("sets avgCost and lastCost when product has no existing cost", async () => {
    mockFindUnique.mockResolvedValue({ id: "p1", name: "Button", sku: "BTN-001", avgCost: null });
    await applyOpeningCost(tx, "p1", 10000);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { avgCost: 10000, lastCost: 10000 },
    });
  });

  it("throws OpeningCostError when product already has avgCost", async () => {
    mockFindUnique.mockResolvedValue({ id: "p1", name: "Button", sku: "BTN-001", avgCost: "8000" });
    await expect(applyOpeningCost(tx, "p1", 10000)).rejects.toThrow(OpeningCostError);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("throws when product is not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(applyOpeningCost(tx, "nonexistent", 10000)).rejects.toThrow();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("throws when cost is zero", async () => {
    mockFindUnique.mockResolvedValue({ id: "p1", name: "Button", sku: "BTN-001", avgCost: null });
    await expect(applyOpeningCost(tx, "p1", 0)).rejects.toThrow();
  });

  it("throws when cost is negative", async () => {
    mockFindUnique.mockResolvedValue({ id: "p1", name: "Button", sku: "BTN-001", avgCost: null });
    await expect(applyOpeningCost(tx, "p1", -500)).rejects.toThrow();
  });
});

// ── applyCorrectCost ─────────────────────────────────────────────────────────
// Overrides avgCost + lastCost regardless of current value

describe("applyCorrectCost", () => {
  let mockFindUnique: ReturnType<typeof vi.fn>;
  let mockUpdate: ReturnType<typeof vi.fn>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;

  beforeEach(() => {
    mockFindUnique = vi.fn();
    mockUpdate = vi.fn().mockResolvedValue({});
    tx = {
      product: { findUnique: mockFindUnique, update: mockUpdate },
    };
  });

  it("overrides avgCost and lastCost when product already has cost", async () => {
    mockFindUnique.mockResolvedValue({ id: "p1", name: "Button", sku: "BTN-001", avgCost: "8000" });
    await applyCorrectCost(tx, "p1", 12000);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { avgCost: 12000, lastCost: 12000 },
    });
  });

  it("also sets cost when product avgCost is NULL (correction on fresh product)", async () => {
    mockFindUnique.mockResolvedValue({ id: "p1", name: "Button", sku: "BTN-001", avgCost: null });
    await applyCorrectCost(tx, "p1", 12000);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { avgCost: 12000, lastCost: 12000 },
    });
  });

  it("returns the old avgCost value (for audit log)", async () => {
    mockFindUnique.mockResolvedValue({ id: "p1", name: "Button", sku: "BTN-001", avgCost: "8000" });
    const { oldAvgCost } = await applyCorrectCost(tx, "p1", 12000);
    expect(oldAvgCost).toBe(8000);
  });

  it("returns null as old avgCost when product had no prior cost", async () => {
    mockFindUnique.mockResolvedValue({ id: "p1", name: "Button", sku: "BTN-001", avgCost: null });
    const { oldAvgCost } = await applyCorrectCost(tx, "p1", 12000);
    expect(oldAvgCost).toBeNull();
  });

  it("throws when product is not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(applyCorrectCost(tx, "nonexistent", 12000)).rejects.toThrow();
  });

  it("throws when cost is zero", async () => {
    mockFindUnique.mockResolvedValue({ id: "p1", name: "Button", sku: "BTN-001", avgCost: "8000" });
    await expect(applyCorrectCost(tx, "p1", 0)).rejects.toThrow();
  });
});

// ── CSV import cost post-pass ────────────────────────────────────────────────

import { applyCostPostPass } from "./opening-cost";

describe("applyCostPostPass", () => {
  let mockFindUnique: ReturnType<typeof vi.fn>;
  let mockUpdate: ReturnType<typeof vi.fn>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;

  beforeEach(() => {
    mockFindUnique = vi.fn();
    mockUpdate = vi.fn().mockResolvedValue({});
    tx = {
      product: { findUnique: mockFindUnique, update: mockUpdate },
    };
  });

  it("sets openingCost for products with NULL avgCost", async () => {
    mockFindUnique.mockResolvedValue({ avgCost: null });
    const count = await applyCostPostPass(tx, [
      { productId: "p1", openingCost: 10000, correctCost: undefined },
    ]);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { avgCost: 10000, lastCost: 10000 },
    });
    expect(count).toBe(1);
  });

  it("skips openingCost for products that already have avgCost", async () => {
    mockFindUnique.mockResolvedValue({ avgCost: "5000" });
    const count = await applyCostPostPass(tx, [
      { productId: "p1", openingCost: 10000, correctCost: undefined },
    ]);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it("applies correctCost regardless of existing avgCost", async () => {
    mockFindUnique.mockResolvedValue({ avgCost: "5000" });
    const count = await applyCostPostPass(tx, [
      { productId: "p1", openingCost: undefined, correctCost: 12000 },
    ]);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { avgCost: 12000, lastCost: 12000 },
    });
    expect(count).toBe(1);
  });

  it("correctCost takes priority over openingCost when both are provided", async () => {
    mockFindUnique.mockResolvedValue({ avgCost: null });
    const count = await applyCostPostPass(tx, [
      { productId: "p1", openingCost: 8000, correctCost: 12000 },
    ]);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { avgCost: 12000, lastCost: 12000 },
    });
    expect(count).toBe(1);
  });

  it("skips rows with no cost columns", async () => {
    const count = await applyCostPostPass(tx, [
      { productId: "p1", openingCost: undefined, correctCost: undefined },
    ]);
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it("skips rows where cost is 0", async () => {
    const count = await applyCostPostPass(tx, [
      { productId: "p1", openingCost: 0, correctCost: 0 },
    ]);
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it("processes multiple rows and returns total updated count", async () => {
    mockFindUnique
      .mockResolvedValueOnce({ avgCost: null })   // p1 — will be set
      .mockResolvedValueOnce({ avgCost: "5000" }) // p2 — openingCost skipped
      .mockResolvedValueOnce({ avgCost: "3000" }); // p3 — correctCost applies
    const count = await applyCostPostPass(tx, [
      { productId: "p1", openingCost: 10000, correctCost: undefined },
      { productId: "p2", openingCost: 10000, correctCost: undefined },
      { productId: "p3", openingCost: undefined, correctCost: 15000 },
    ]);
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(count).toBe(2);
  });
});
