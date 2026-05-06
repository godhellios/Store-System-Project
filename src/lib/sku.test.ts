import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateSku } from "./sku";

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------

const mockFindUniqueCategory = vi.fn();
const mockFindFirstProduct = vi.fn();
const mockFindUniqueProduct = vi.fn();

const tx = {
  category: {
    findUnique: mockFindUniqueCategory,
  },
  product: {
    findFirst: mockFindFirstProduct,
    findUnique: mockFindUniqueProduct,
  },
};

// generateSku accepts a TransactionClient; cast to any to satisfy TypeScript
// without importing the real prisma client in tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const txClient = tx as any;

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateSku", () => {
  it("1. Format: generated SKU matches CAT-##### pattern", async () => {
    mockFindUniqueCategory.mockResolvedValue({ name: "Thread", code: "THR" });
    mockFindFirstProduct.mockResolvedValue(null);           // no existing SKUs
    mockFindUniqueProduct.mockResolvedValue(null);          // candidate is free

    const sku = await generateSku("cat-1", txClient);

    expect(sku).toMatch(/^[A-Z]+-\d{5}$/);
    expect(sku).toBe("THR-00001");
  });

  it("2. Increment: second product in same category gets THR-00002", async () => {
    mockFindUniqueCategory.mockResolvedValue({ name: "Thread", code: "THR" });
    // Existing max SKU is THR-00001
    mockFindFirstProduct.mockResolvedValue({ sku: "THR-00001" });
    mockFindUniqueProduct.mockResolvedValue(null);          // candidate is free

    const sku = await generateSku("cat-1", txClient);

    expect(sku).toBe("THR-00002");
  });

  it("3. Gap handling: if max existing SKU is THR-00003, next is THR-00004", async () => {
    mockFindUniqueCategory.mockResolvedValue({ name: "Thread", code: "THR" });
    // MAX-based: highest SKU regardless of gaps
    mockFindFirstProduct.mockResolvedValue({ sku: "THR-00003" });
    mockFindUniqueProduct.mockResolvedValue(null);

    const sku = await generateSku("cat-1", txClient);

    expect(sku).toBe("THR-00004");
  });

  it("4. No code: throws error with category name when category has no code", async () => {
    mockFindUniqueCategory.mockResolvedValue({ name: "Buttons", code: null });

    await expect(generateSku("cat-2", txClient)).rejects.toThrow("Buttons");
    await expect(generateSku("cat-2", txClient)).rejects.toThrow(
      "Admin must set it in Settings"
    );
  });

  it("4b. No code: throws with categoryId in message when category is not found", async () => {
    mockFindUniqueCategory.mockResolvedValue(null);

    await expect(generateSku("missing-id", txClient)).rejects.toThrow(
      "missing-id"
    );
  });

  it("5. Uniqueness: if candidate already exists, retries with next number", async () => {
    mockFindUniqueCategory.mockResolvedValue({ name: "Thread", code: "THR" });
    mockFindFirstProduct.mockResolvedValue({ sku: "THR-00001" });

    // First candidate THR-00002 is taken, second THR-00003 is free
    mockFindUniqueProduct
      .mockResolvedValueOnce({ sku: "THR-00002" }) // collision
      .mockResolvedValueOnce(null);                 // free

    const sku = await generateSku("cat-1", txClient);

    expect(sku).toBe("THR-00003");
    expect(mockFindUniqueProduct).toHaveBeenCalledTimes(2);
  });
});
