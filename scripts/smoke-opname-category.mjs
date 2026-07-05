// End-to-end smoke for category-scoped opname. Real Next.js routes + real NextAuth
// login, no mocks. Verifies the sheet is category-scoped and the transaction lock
// only blocks counted categories. Restores every row it touches. LOCAL dev only.
import { readFileSync } from "node:fs";
import pg from "pg";

const BASE = "http://localhost:3000";
const REF = `SMOKE-OPNCAT-${Date.now()}`;
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = env.split(/\r?\n/).find((l) => /^\s*DATABASE_URL\s*=/.test(l))
  .replace(/^\s*DATABASE_URL\s*=\s*/, "").trim().replace(/^["']|["']$/g, "");
const db = new pg.Client({ connectionString: dbUrl });

const jar = new Map();
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
function absorb(res) { for (const c of res.headers.getSetCookie?.() ?? []) { const p = c.split(";")[0]; const i = p.indexOf("="); jar.set(p.slice(0, i), p.slice(i + 1)); } }
async function login(email, password) {
  jar.clear();
  const cr = await fetch(`${BASE}/api/auth/csrf`); absorb(cr); const { csrfToken } = await cr.json();
  const r = await fetch(`${BASE}/api/auth/callback/credentials`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie() }, body: new URLSearchParams({ csrfToken, email, password, callbackUrl: BASE, json: "true" }), redirect: "manual" }); absorb(r);
  const s = await (await fetch(`${BASE}/api/auth/session`, { headers: { Cookie: cookie() } })).json();
  return s?.user?.role ?? null;
}
const startCount = (locationId, categoryIds) => fetch(`${BASE}/api/opname`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie() }, body: JSON.stringify({ locationId, categoryIds }) });
const goodsOut = (fromLocationId, productId) => fetch(`${BASE}/api/orders`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie() }, body: JSON.stringify({ type: "GOODS_OUT", fromLocationId, customer: "smoke", reference: REF, lines: [{ productId, quantity: 1 }] }) });

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { (ok ? pass++ : fail++); console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function main() {
  await db.connect();
  const stockSnap = (await db.query(`SELECT id, quantity FROM "Stock"`)).rows;
  const one = async (q, p = []) => (await db.query(q, p)).rows[0];
  const BIG = (await one(`SELECT id FROM "Location" WHERE name='Big Warehouse'`)).id;
  const THREAD = (await one(`SELECT id FROM "Category" WHERE name='Thread'`)).id;
  const BUTTON = (await one(`SELECT id FROM "Category" WHERE name='Button'`)).id;
  const FABRIC = (await one(`SELECT id FROM "Category" WHERE name='Fabric'`)).id;
  const threadProd = (await one(`SELECT s."productId" id FROM "Stock" s JOIN "Product" p ON p.id=s."productId" WHERE s."locationId"=$1 AND p."categoryId"=$2 AND s.quantity>0 LIMIT 1`, [BIG, THREAD])).id;
  const buttonProd = (await one(`SELECT s."productId" id FROM "Stock" s JOIN "Product" p ON p.id=s."productId" WHERE s."locationId"=$1 AND p."categoryId"=$2 AND s.quantity>0 LIMIT 1`, [BIG, BUTTON])).id;
  const createdSessions = [];

  try {
    const role = await login("admin@mitraramah.com", "wirawan123");
    check("admin login", role === "ADMIN", `role=${role}`);

    // A: start a Thread-only count; sheet must contain only Thread products
    let res = await startCount(BIG, [THREAD]);
    let body = await res.json().catch(() => ({}));
    check("A start Thread count → 201", res.status === 201, `status=${res.status}`);
    if (body.id) createdSessions.push(body.id);
    const sheet = await db.query(`SELECT p."categoryId" cat FROM "OpnameLine" ol JOIN "Product" p ON p.id=ol."productId" WHERE ol."sessionId"=$1`, [body.id]);
    check("A count sheet contains only Thread products", sheet.rows.length > 0 && sheet.rows.every((r) => r.cat === THREAD), `${sheet.rows.length} lines`);

    // B: a Button goods-out at Big is NOT blocked by the Thread count
    res = await goodsOut(BIG, buttonProd);
    body = await res.json().catch(() => ({}));
    check("B Button goods-out allowed (not opname-blocked)", res.status < 400 && !/stock count/i.test(body.error || ""), `status=${res.status}`);

    // C: a Thread goods-out at Big IS blocked
    res = await goodsOut(BIG, threadProd);
    body = await res.json().catch(() => ({}));
    check("C Thread goods-out blocked → 409", res.status === 409 && /stock count/i.test(body.error || "") && /Thread/.test(body.error || ""), `status=${res.status} err="${body.error}"`);

    // D: a second Thread count at Big overlaps → rejected
    res = await startCount(BIG, [THREAD]);
    body = await res.json().catch(() => ({}));
    if (body.id) createdSessions.push(body.id);
    check("D overlapping Thread count → 409", res.status === 409, `status=${res.status}`);

    // E: a Fabric count runs concurrently
    res = await startCount(BIG, [FABRIC]);
    body = await res.json().catch(() => ({}));
    if (body.id) createdSessions.push(body.id);
    check("E concurrent Fabric count → 201", res.status === 201, `status=${res.status}`);

    // F: non-admin cannot start a count
    const staffRole = await login("staff@mitraramah.com", "staff123");
    res = await startCount(BIG, [THREAD]);
    check("F staff blocked → 403", res.status === 403, `loginRole=${staffRole} status=${res.status}`);
  } finally {
    // cleanup: created orders (by reference) + their children, created sessions, stock
    const orderIds = (await db.query(`SELECT id FROM "Order" WHERE reference=$1`, [REF])).rows.map((r) => r.id);
    if (orderIds.length) {
      await db.query(`DELETE FROM "Movement" WHERE "orderId" = ANY($1)`, [orderIds]);
      await db.query(`DELETE FROM "OrderLine" WHERE "orderId" = ANY($1)`, [orderIds]);
      await db.query(`DELETE FROM "Order" WHERE id = ANY($1)`, [orderIds]);
    }
    if (createdSessions.length) await db.query(`DELETE FROM "OpnameSession" WHERE id = ANY($1)`, [createdSessions]); // cascades lines + category links
    for (const s of stockSnap) await db.query(`UPDATE "Stock" SET quantity=$2 WHERE id=$1`, [s.id, s.quantity]);
    console.log("cleanup done (orders, sessions, stock restored)");
    await db.end();
  }

  console.log(`\n${fail === 0 ? "✅ SMOKE PASSED" : "❌ SMOKE FAILED"} (${pass} passed, ${fail} failed)`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); try { await db.end(); } catch {} process.exit(1); });
