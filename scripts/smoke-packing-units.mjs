// End-to-end smoke for packing units sourced from the Unit master.
//
// Covers what unit tests cannot: that a scanned packing barcode still resolves
// to the right factor, that a product can only be given units belonging to its
// base unit, and — the whole point of the change — that renaming a unit in
// Settings flows to every product without touching product rows.
//
// Run against LOCAL dev (Neon) only, dev server on :3000.
import { readFileSync } from "node:fs";
import pg from "pg";

const BASE = "http://localhost:3000";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = env.split(/\r?\n/).find((l) => /^\s*DATABASE_URL\s*=/.test(l))
  .replace(/^\s*DATABASE_URL\s*=\s*/, "").trim().replace(/^["']|["']$/g, "");
if (/supabase/i.test(dbUrl)) throw new Error("refusing to run against production");
const db = new pg.Client({ connectionString: dbUrl });

const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
function absorb(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
}
async function login(email, password) {
  jar.clear();
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  absorb(csrfRes);
  const { csrfToken } = await csrfRes.json();
  absorb(await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookieHeader() },
    body: new URLSearchParams({ csrfToken, email, password, callbackUrl: BASE, json: "true" }),
    redirect: "manual",
  }));
  const s = await (await fetch(`${BASE}/api/auth/session`, { headers: { Cookie: cookieHeader() } })).json();
  return s?.user?.role ?? null;
}
const api = (method, path, body) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookieHeader() },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { (ok ? pass++ : fail++); console.log(`${ok ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };

const createdProductIds = [];
let renamedUnitId = null, originalUnitName = null;

async function main() {
  await db.connect();
  check("admin login", (await login("admin@mitraramah.com", "wirawan123")) === "ADMIN");

  // A packing unit and a product that uses it (seeded to mirror production).
  const { rows: [pack] } = await db.query(`
    SELECT c.id AS conv_id, c.barcode, c."productId", p.sku, p."unitId" AS base_unit_id,
           u.id AS unit_id, u.name AS unit_name, u."conversionFactor" AS factor, bu.name AS base_name
    FROM "ProductUnitConversion" c
    JOIN "Product" p ON p.id = c."productId"
    JOIN "Unit" u ON u.id = c."unitId"
    JOIN "Unit" bu ON bu.id = p."unitId"
    WHERE c.barcode IS NOT NULL LIMIT 1`);
  if (!pack) throw new Error("no packing unit found — run the seed first");
  console.log(`Using ${pack.sku}: 1 ${pack.unit_name} = ${pack.factor} ${pack.base_name}`);

  // ── Scanning a packing barcode returns the factor from the MASTER ─────────
  let r = await api("GET", `/api/products/lookup?q=${encodeURIComponent(pack.barcode)}`);
  let data = await r.json();
  check("SCAN: packing barcode resolves", r.status === 200, `status=${r.status} err=${data.error}`);
  check("SCAN: name comes from the Unit master", data.matchedUnit?.name === pack.unit_name,
    `got="${data.matchedUnit?.name}" want="${pack.unit_name}"`);
  check("SCAN: factor comes from the Unit master", Number(data.matchedUnit?.conversionFactor) === Number(pack.factor),
    `got=${data.matchedUnit?.conversionFactor} want=${pack.factor}`);
  check("SCAN: product carries its packing list with factors",
    Array.isArray(data.product?.unitConversions) &&
    data.product.unitConversions.every((c) => typeof c.name === "string" && c.conversionFactor > 0),
    `list=${JSON.stringify(data.product?.unitConversions)}`);

  // ── Search feeds the entry forms the same flattened shape ─────────────────
  r = await api("GET", `/api/products/search?q=${encodeURIComponent(pack.sku)}&full=1`);
  const found = (await r.json()).find((p) => p.sku === pack.sku);
  check("SEARCH: returns packing units with name + factor",
    !!found?.unitConversions?.some((c) => c.name === pack.unit_name && Number(c.conversionFactor) === Number(pack.factor)),
    `got=${JSON.stringify(found?.unitConversions)}`);

  // ── A unit from a DIFFERENT base unit is rejected ─────────────────────────
  const { rows: [alien] } = await db.query(
    `SELECT id, name FROM "Unit" WHERE "parentUnitId" IS NOT NULL AND "parentUnitId" <> $1 LIMIT 1`, [pack.base_unit_id]);
  const { rows: [cat] } = await db.query(`SELECT id FROM "Category" WHERE code IS NOT NULL LIMIT 1`);
  if (alien) {
    r = await api("POST", "/api/products", {
      name: `Smoke Packing Reject ${Date.now()}`, categoryId: cat.id, unitId: pack.base_unit_id,
      reorderPoint: 0, force: true, unitConversions: [{ unitId: alien.id }],
    });
    data = await r.json();
    if (data.product?.id) createdProductIds.push(data.product.id);
    check("REJECT: unit measured in another base unit → 400", r.status === 400, `status=${r.status} err="${data.error}"`);
  } else {
    console.log("… skipped mismatch test (no second-parent unit locally)");
  }

  // ── Creating with a VALID packing unit works, factor not sent ─────────────
  r = await api("POST", "/api/products", {
    name: `Smoke Packing OK ${Date.now()}`, categoryId: cat.id, unitId: pack.base_unit_id,
    reorderPoint: 0, force: true, unitConversions: [{ unitId: pack.unit_id }],
  });
  data = await r.json();
  const newId = data.id ?? data.product?.id;
  if (newId) createdProductIds.push(newId);
  check("CREATE: valid packing unit accepted → 201", r.status === 201, `status=${r.status} err="${data.error}"`);
  const { rows: [stored] } = await db.query(
    `SELECT "unitId", name, "conversionFactor" FROM "ProductUnitConversion" WHERE "productId" = $1`, [newId ?? ""]);
  check("CREATE: stored as a unit reference", stored?.unitId === pack.unit_id, `unitId=${stored?.unitId}`);
  check("CREATE: no name/factor copied onto the product",
    stored?.name === null && stored?.conversionFactor === null,
    `name=${stored?.name} factor=${stored?.conversionFactor}`);

  // ── THE POINT: rename in Settings, every product follows ──────────────────
  originalUnitName = pack.unit_name;
  renamedUnitId = pack.unit_id;
  const newName = `${pack.unit_name} RENAMED`;
  r = await api("PUT", `/api/units/${pack.unit_id}`, { name: newName });
  check("RENAME: unit renamed in Settings → 200", r.status === 200, `status=${r.status}`);

  r = await api("GET", `/api/products/lookup?q=${encodeURIComponent(pack.barcode)}`);
  data = await r.json();
  check("RENAME: scan now shows the NEW name, with no product update",
    data.matchedUnit?.name === newName, `got="${data.matchedUnit?.name}" want="${newName}"`);
  check("RENAME: factor unchanged", Number(data.matchedUnit?.conversionFactor) === Number(pack.factor));

  // ── Changing the size warns first, then applies on confirm ────────────────
  r = await api("PUT", `/api/units/${pack.unit_id}`, { name: newName, conversionFactor: Number(pack.factor) + 1 });
  data = await r.json();
  check("FACTOR: change on a unit in use warns first", r.status === 200 && data.warning === "unit_in_use",
    `status=${r.status} body=${JSON.stringify(data)}`);
  check("FACTOR: warning reports the affected product count", (data.productCount ?? 0) > 0, `count=${data.productCount}`);
  const { rows: [unchanged] } = await db.query(`SELECT "conversionFactor" f FROM "Unit" WHERE id=$1`, [pack.unit_id]);
  check("FACTOR: not applied while unconfirmed", Number(unchanged.f) === Number(pack.factor), `factor=${unchanged.f}`);

  // ── A unit used for packing cannot be deleted ─────────────────────────────
  r = await api("DELETE", `/api/units/${pack.unit_id}`);
  data = await r.json().catch(() => ({}));
  check("DELETE: unit in use as packing → 409", r.status === 409, `status=${r.status} err="${data.error}"`);

  // ── cleanup ──────────────────────────────────────────────────────────────
  if (renamedUnitId && originalUnitName)
    await db.query(`UPDATE "Unit" SET name=$2 WHERE id=$1`, [renamedUnitId, originalUnitName]);
  if (createdProductIds.length) {
    await db.query(`DELETE FROM "ProductUnitConversion" WHERE "productId" = ANY($1::text[])`, [createdProductIds]);
    await db.query(`DELETE FROM "AuditLog" WHERE "entityId" = ANY($1::text[])`, [createdProductIds]);
    await db.query(`DELETE FROM "Product" WHERE id = ANY($1::text[])`, [createdProductIds]);
  }
  const { rows: [restored] } = await db.query(`SELECT name FROM "Unit" WHERE id=$1`, [renamedUnitId]);
  check("cleanup: unit name restored, test products removed", restored?.name === originalUnitName,
    `name="${restored?.name}"`);

  await db.end();
  console.log(`\n${fail === 0 ? "✅ SMOKE PASSED" : "❌ SMOKE FAILED"} (${pass} passed, ${fail} failed)`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); try { await db.end(); } catch {} process.exit(1); });
