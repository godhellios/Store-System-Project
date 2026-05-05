export type ProductSku = {
  id: string;
  sku: string;
  name: string;
  imageUrl: string | null;
};

export type MatchStatus = "matched" | "unmatched" | "dismissed";

export type FileRow = {
  file: File;
  filename: string;
  status: MatchStatus;
  productId: string | null;
  productName: string | null;
  productSku: string | null;
  hasExistingImage: boolean;
};

export type UploadSave = {
  productId: string;
  url: string;
};

export type BulkSaveResult = {
  saved: number;
  failed: number;
  errors: { productId: string; message: string }[];
};
