// End-to-end smoke for backdating at ENTRY (POST /api/orders effectiveDate).
// Exercises the REAL Next.js route via real NextAuth login — no mocks. Verifies
// DB side effects directly and fully restores stock + deletes everything it
// creates. Run against LOCAL dev (Neon) only, with the dev server on :3000.
import { readFileSync } from "node:fs";
import pg from "pg";

const BASE = "http://localhost:3000";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = env.split(/\r?\n/).find((l) => /^\s*DATABASE_URL\s*=/.test(l))
  .replace(/^\s*DATABASE_URL\s*=\s*/, "").trim().replace(/^["']|["']$/g, "");
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
  const body = new URLSearchParams({ csrfToken, email, password, callbackUrl: BASE, json: "true" });
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookieHeader() },
    body, redirect: "manual",
  });
  absorb(res);
  const sess = await (await fetch(`${BASE}/api/auth/session`, { headers: { Cookie: cookieHeader() } })).json();
  return sess?.user?.role ?? null;
}

const createOrder = (payload) =>
  fetch(`${BASE}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader() },
    body: JSON.stringify(payload),
  });

// Jakarta calendar date "YYYY-MM-DD", n days ago.
const dayStr = (n) => new Date(Date.now() - n * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { (ok ? pass++ : fail++); console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`); };

const created = []; // order ids to clean up

async function main() {
  await db.connect();
  const role = await login("admin@mitraramah.com", "wirawan123");
  check("admin login", role === "ADMIN", `role=${role}`);

  // Pick an active product with stock at a location that has NO approved opname
  // (so backdating isn't frozen). Highest qty for headroom.
  const { rows: [pick] } = await db.query(`
    SELECT s."productId", s."locationId", s.quantity, p.name
    FROM "Stock" s JOIN "Product" p ON p.id = s."productId"
    WHERE p."isActive" = true
      AND s."locationId" NOT IN (SELECT DISTINCT "locationId" FROM "OpnameSession" WHERE status='APPROVED')
    ORDER BY s.quantity DESC LIMIT 1`);
  if (!pick) throw new Error("no suitable (active product, opname-free location) stock row found");
  const { productId, locationId } = pick;
  const Q0 = Number(pick.quantity);
  console.log(`Using "${pick.name}" @ ${locationId} — starting qty ${Q0}`);
  const line = (qty) => [{ productId, quantity: qty }];
  const stockNow = async () =>
    Number((await db.query(`SELECT quantity FROM "Stock" WHERE "productId"=$1 AND "locationId"=$2`, [productId, locationId])).rows[0].quantity);

  const oldDate = dayStr(25);    // "OUT dated before the stock arrived"
  const recentDate = dayStr(3);  // "stock arrived recently"

  // ── Test 4 first (needs a clean history window) ────────────────────────────
  // A backdated GRN of +50 recently, then a backdated OUT dated 25d ago that
  // today's balance covers but that day's balance did NOT → soft warning.
  let res = await createOrder({ type: "GRN", toLocationId: locationId, effectiveDate: recentDate, lines: line(50) });
  let data = await res.json(); if (data.order) created.push(data.order.id);
  check("setup: backdated GRN +50 → 201", res.status === 201, `status=${res.status}`);

  res = await createOrder({ type: "GOODS_OUT", fromLocationId: locationId, effectiveDate: oldDate, lines: line(Q0 + 10) });
  data = await res.json(); if (data.order) created.push(data.order.id);
  check("WARN: backdated OUT covered today but not then → 201", res.status === 201, `status=${res.status}`);
  check("WARN: past-negative warning returned", Array.isArray(data.warnings) && data.warnings.some((w) => /negative/i.test(w)),
    `warnings=${JSON.stringify(data.warnings)}`);

  // No-warning control: small OUT dated recentDate, plenty on hand as of then.
  res = await createOrder({ type: "GOODS_OUT", fromLocationId: locationId, effectiveDate: recentDate, lines: line(1) });
  data = await res.json(); if (data.order) created.push(data.order.id);
  check("NO-WARN: sufficient as-of-date → 201, no warning", res.status === 201 && !(data.warnings?.length),
    `status=${res.status} warnings=${JSON.stringify(data.warnings)}`);

  // ── Test 1: happy-path backdated GRN stamps the date on order + movements ───
  const grnDate = dayStr(20);
  const before = await stockNow();
  res = await createOrder({ type: "GRN", toLocationId: locationId, effectiveDate: grnDate, lines: line(7) });
  data = await res.json(); if (data.order) created.push(data.order.id);
  check("GRN: backdated → 201", res.status === 201, `status=${res.status}`);
  const oid = data.order?.id;
  const expectWC = `${grnDate} 05:00:00`; // noon Jakarta = 05:00 UTC
  const ord = (await db.query(`SELECT to_char("effectiveDate",'YYYY-MM-DD HH24:MI:SS') wc FROM "Order" WHERE id=$1`, [oid])).rows[0];
  const mvs = (await db.query(`SELECT to_char("effectiveDate",'YYYY-MM-DD HH24:MI:SS') wc FROM "Movement" WHERE "orderId"=$1`, [oid])).rows;
  check("GRN: order.effectiveDate = Jakarta noon", ord.wc === expectWC, `stored="${ord.wc}"`);
  check("GRN: movements synced to same date", mvs.length > 0 && mvs.every((m) => m.wc === expectWC), `${mvs.length} mv, first="${mvs[0]?.wc}"`);
  check("GRN: stock incremented by 7 (admin immediate)", (await stockNow()) === before + 7, `${before} → ${await stockNow()}`);
  const al = (await db.query(`SELECT description FROM "AuditLog" WHERE "entityId"=$1 AND action='CREATE_GRN'`, [oid])).rows[0];
  check("GRN: audit log notes the backdate", /backdated to/i.test(al?.description || ""), `desc="${al?.description}"`);

  // ── Test 2: future date is rejected ────────────────────────────────────────
  res = await createOrder({ type: "GRN", toLocationId: locationId, effectiveDate: dayStr(-2), lines: line(1) });
  data = await res.json(); if (data.order) created.push(data.order.id);
  check("FUTURE: future date → 409", res.status === 409 && /future/i.test(data.error || ""), `status=${res.status} err="${data.error}"`);

  // ── Test 3: opname freeze — insert an APPROVED count, then try to date before ─
  const sessNum = `SMOKE-BD-${Date.now()}`;
  const floorTs = new Date(Date.now() - 10 * 86400000).toISOString();
  await db.query(
    `INSERT INTO "OpnameSession" (id,"sessionNumber","locationId",status,"approvedAt","createdAt")
     VALUES ($1,$2,$3,'APPROVED',$4,now())`,
    [`smoke_${Date.now()}`, sessNum, locationId, floorTs]);
  res = await createOrder({ type: "GRN", toLocationId: locationId, effectiveDate: dayStr(15), lines: line(1) });
  data = await res.json(); if (data.order) created.push(data.order.id);
  check("FREEZE: date before approved count → 409", res.status === 409 && /stock count/i.test(data.error || ""), `status=${res.status} err="${data.error}"`);
  res = await createOrder({ type: "GRN", toLocationId: locationId, effectiveDate: dayStr(5), lines: line(1) });
  data = await res.json(); if (data.order) created.push(data.order.id);
  check("FREEZE: date after approved count → 201", res.status === 201, `status=${res.status}`);
  await db.query(`DELETE FROM "OpnameSession" WHERE "sessionNumber"=$1`, [sessNum]);

  // ── Test 5: staff cannot backdate ──────────────────────────────────────────
  const staffRole = await login("staff@mitraramah.com", "staff123");
  res = await createOrder({ type: "GRN", toLocationId: locationId, effectiveDate: dayStr(5), lines: line(1) });
  data = await res.json(); if (data.order) created.push(data.order.id);
  check("STAFF: backdate forbidden → 403", res.status === 403, `loginRole=${staffRole} status=${res.status}`);

  // ── cleanup: delete everything created, restore stock to Q0 ────────────────
  if (created.length) {
    await db.query(`DELETE FROM "Movement" WHERE "orderId" = ANY($1::text[])`, [created]);
    await db.query(`DELETE FROM "OrderLine" WHERE "orderId" = ANY($1::text[])`, [created]);
    await db.query(`DELETE FROM "AuditLog" WHERE "entityId" = ANY($1::text[])`, [created]);
    await db.query(`DELETE FROM "Order" WHERE id = ANY($1::text[])`, [created]);
  }
  await db.query(`UPDATE "Stock" SET quantity=$3 WHERE "productId"=$1 AND "locationId"=$2`, [productId, locationId, Q0]);
  const restored = await stockNow();
  check("cleanup: stock restored to starting qty", restored === Q0, `${restored} vs ${Q0}`);
  console.log(`cleanup done (${created.length} orders removed, stock restored)`);

  await db.end();
  console.log(`\n${fail === 0 ? "✅ SMOKE PASSED" : "❌ SMOKE FAILED"} (${pass} passed, ${fail} failed)`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); try { await db.end(); } catch {} process.exit(1); });
