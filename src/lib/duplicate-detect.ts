import { prisma } from "@/lib/prisma";

export type SimilarProduct = {
  id: string;
  name: string;
  sku: string;
  score: number; // 0-1
};

// Inline Levenshtein distance — no external library
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

function similarity(a: string, b: string): number {
  const na = normalize(a), nb = normalize(b);
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(na, nb) / maxLen;
}

const THRESHOLD = 0.80;

export async function findSimilarProducts(
  name: string,
  excludeId?: string
): Promise<SimilarProduct[]> {
  const products = await prisma.product.findMany({
    select: { id: true, name: true, sku: true },
  });

  return products
    .filter(p => p.id !== excludeId)
    .map(p => ({ ...p, score: similarity(name, p.name) }))
    .filter(p => p.score >= THRESHOLD)
    .sort((a, b) => b.score - a.score);
}
