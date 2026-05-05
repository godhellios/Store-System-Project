import type { FileRow, ProductSku } from "./types";

export function matchBySku(files: File[], products: ProductSku[]): FileRow[] {
  const skuMap = new Map<string, ProductSku>(
    products.map((p) => [p.sku.toLowerCase(), p])
  );
  const matchedProductIds = new Set<string>();

  return files.map((file) => {
    const filename = file.name;
    const stem = filename.includes(".")
      ? filename.slice(0, filename.lastIndexOf("."))
      : filename;
    const product = skuMap.get(stem.toLowerCase());

    if (product && !matchedProductIds.has(product.id)) {
      matchedProductIds.add(product.id);
      return {
        file,
        filename,
        status: "matched",
        productId: product.id,
        productName: product.name,
        productSku: product.sku,
        hasExistingImage: !!product.imageUrl,
      };
    }

    return {
      file,
      filename,
      status: "unmatched",
      productId: null,
      productName: null,
      productSku: null,
      hasExistingImage: false,
    };
  });
}
