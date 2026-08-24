// Read-only audit: find ProductUnitConversion rows whose unit's parent does NOT
// match the product's own base unit.
//
// Context: the 20260813000001_packing_unit_from_master migration backfilled the
// old free-typed (name, conversionFactor) pairs onto a real Unit purely by name
// match. It could not detect or repair a case where the typed name matched a
// real unit whose parent doesn't correspond to the product's actual base unit
// — it just carries the mismatch forward. Those rows are exactly what lets a
// box/case/sack factor get silently applied against the wrong base unit on the
// next GRN / Goods Out / Transfer that uses them.
//
// This script only SELECTs. It never writes.
//
// Usage:
//   node scripts/audit-stale-packing-units.mjs            # local dev (.env DATABASE_URL)
//   AUDIT_DATABASE_URL="postgresql://...supabase..." \
//     node scripts/audit-stale-packing-units.mjs           # explicit target, e.g. production
import { readFileSync } from "node:fs";
import pg from "pg";

function resolveUrl() {
  if (process.env.AUDIT_DATABASE_URL) return process.env.AUDIT_DATABASE_URL;
  const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
  const line = env.split(/\r?\n/).find((l) => /^\s*DATABASE_URL\s*=/.test(l));
  if (!line) throw new Error("No DATABASE_URL found in .env and AUDIT_DATABASE_URL not set");
  return line.replace(/^\s*DATABASE_URL\s*=\s*/, "").trim().replace(/^["']|["']$/g, "");
}

function describeTarget(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`; // no credentials in the log
  } catch {
    return "(unparseable URL)";
  }
}

const dbUrl = resolveUrl();
console.log(`Auditing: ${describeTarget(dbUrl)}${/supabase/i.test(dbUrl) ? "  (PRODUCTION)" : "  (dev)"}`);

const db = new pg.Client({ connectionString: dbUrl });
await db.connect();

const { rows } = await db.query(`
  SELECT p.id AS product_id, p.name AS product_name, p.sku,
         u.name AS product_base_unit,
         puc.id AS conversion_id, pu.name AS packing_unit_name,
         pu."parentUnitId", pu.name AS packing_unit_parent_name_lookup
  FROM "ProductUnitConversion" puc
  JOIN "Product" p ON p.id = puc."productId"
  JOIN "Unit" u ON u.id = p."unitId"
  JOIN "Unit" pu ON pu.id = puc."unitId"
  LEFT JOIN "Unit" parent ON parent.id = pu."parentUnitId"
  WHERE pu."parentUnitId" IS DISTINCT FROM p."unitId"
  ORDER BY p.name;
`);

await db.end();

if (rows.length === 0) {
  console.log("✅ No stale packing units found — every ProductUnitConversion's unit parent matches its product's base unit.");
  process.exit(0);
}

console.log(`❌ Found ${rows.length} stale packing unit(s):\n`);
for (const r of rows) {
  console.log(
    `  Product "${r.product_name}" (${r.sku}, base unit: ${r.product_base_unit})\n` +
    `    → packing unit "${r.packing_unit_name}" (conversion id: ${r.conversion_id}) has a different/mismatched parent\n`
  );
}
console.log("Fix each of these from the product's edit screen (they should show the amber \"stale\" warning) before relying on the approve-workflow guard.");
process.exit(1);
