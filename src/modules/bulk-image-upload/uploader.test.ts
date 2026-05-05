import { describe, it, expect } from "vitest";
import { matchBySku } from "./uploader";
import type { ProductSku } from "./types";

const products: ProductSku[] = [
  { id: "1", sku: "BTN-12-BLK", name: "Button 12 Black", imageUrl: null },
  { id: "2", sku: "BTN-12-RED", name: "Button 12 Red", imageUrl: null },
  { id: "3", sku: "SHT-05-WHT", name: "Shirt 05 White", imageUrl: "https://existing.com/img.jpg" },
];

function file(name: string) {
  return new File(["x"], name, { type: "image/jpeg" });
}

describe("matchBySku", () => {
  it("matches file whose stem exactly equals a SKU", () => {
    const result = matchBySku([file("BTN-12-BLK.jpg")], products);
    expect(result[0].status).toBe("matched");
    expect(result[0].productId).toBe("1");
    expect(result[0].productName).toBe("Button 12 Black");
  });

  it("matches case-insensitively", () => {
    const result = matchBySku([file("btn-12-blk.JPG")], products);
    expect(result[0].status).toBe("matched");
    expect(result[0].productId).toBe("1");
  });

  it("strips extension before matching", () => {
    const exts = ["jpg", "jpeg", "png", "webp"];
    for (const ext of exts) {
      const result = matchBySku([file(`BTN-12-RED.${ext}`)], products);
      expect(result[0].status).toBe("matched");
    }
  });

  it("marks file as unmatched when no SKU found", () => {
    const result = matchBySku([file("UNKNOWN-SKU.jpg")], products);
    expect(result[0].status).toBe("unmatched");
    expect(result[0].productId).toBeNull();
  });

  it("returns empty array for empty file list", () => {
    expect(matchBySku([], products)).toEqual([]);
  });

  it("marks all files unmatched when product list is empty", () => {
    const result = matchBySku([file("BTN-12-BLK.jpg")], []);
    expect(result[0].status).toBe("unmatched");
  });

  it("prevents two files from matching the same product — second gets unmatched", () => {
    const result = matchBySku(
      [file("BTN-12-BLK.jpg"), file("BTN-12-BLK.png")],
      products
    );
    expect(result[0].status).toBe("matched");
    expect(result[0].productId).toBe("1");
    expect(result[1].status).toBe("unmatched");
  });

  it("flags matched product that already has an imageUrl as hasExistingImage true", () => {
    const result = matchBySku([file("SHT-05-WHT.jpg")], products);
    expect(result[0].status).toBe("matched");
    expect(result[0].hasExistingImage).toBe(true);
  });

  it("flags matched product with no imageUrl as hasExistingImage false", () => {
    const result = matchBySku([file("BTN-12-BLK.jpg")], products);
    expect(result[0].hasExistingImage).toBe(false);
  });

  it("preserves filename on each row", () => {
    const result = matchBySku([file("BTN-12-BLK.jpg")], products);
    expect(result[0].filename).toBe("BTN-12-BLK.jpg");
  });
});
