// End-to-end smoke for the effective-date editing route (Slice 2). Exercises the
// REAL Next.js route via real NextAuth login — no mocks. Verifies DB side effects
// directly. Restores all data it touches. Run against LOCAL dev (Neon) only.
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
    body,
    redirect: "manual",
  });
  absorb(res);
  const sess = await (await fetch(`${BASE}/api/auth/session`, { headers: { Cookie: cookieHeader() } })).json();
  return sess?.user?.role ?? null;
}

const patch = (orderId, payload) =>
  fetch(`${BASE}/api/orders/${orderId}/effective-date`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader() },
    body: JSON.stringify(payload),
  });

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { (ok ? pass++ : fail++); console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function main() {
  await db.connect();
  const role = await login("admin@mitraramah.com", "wirawan123");
  check("admin login", role === "ADMIN", `role=${role}`);

  const { rows: [order] } = await db.query(
    `SELECT id, "orderNumber", "toLocationId", "fromLocationId", "effectiveDate"
     FROM "Order" WHERE "cancelledAt" IS NULL AND "toLocationId" IS NOT NULL LIMIT 1`);
  const loc = order.toLocationId;
  const origEffective = order.effectiveDate;
  console.log(`Using order ${order.orderNumber} (${order.id}) @ location ${loc}`);

  // Seed orders have no Movement rows; insert one synthetic movement so we can
  // verify the route syncs child movements. Removed in cleanup.
  const { rows: [line] } = await db.query(`SELECT id, "productId" FROM "OrderLine" WHERE "orderId"=$1 LIMIT 1`, [order.id]);
  const smokeMvId = `smoke_mv_${Date.now()}`;
  await db.query(
    `INSERT INTO "Movement" (id, "orderId", "orderLineId", "productId", quantity, type, "createdAt", "effectiveDate")
     VALUES ($1,$2,$3,$4,1,'TRANSFER', now(), NULL)`,
    [smokeMvId, order.id, line.id, line.productId]);

  // A) allowed past date
  let res = await patch(order.id, { effectiveDate: "2026-06-05", reason: "smoke: backdate" });
  check("A allowed past date → 200", res.status === 200, `status=${res.status}`);
  const { rows: [o2] } = await db.query(`SELECT "effectiveDate" FROM "Order" WHERE id=$1`, [order.id]);
  const { rows: mv } = await db.query(`SELECT "effectiveDate" FROM "Movement" WHERE "orderId"=$1`, [order.id]);
  const expected = new Date("2026-06-05T12:00:00+07:00").getTime();
  check("A order date stored at Jakarta noon", o2.effectiveDate && new Date(o2.effectiveDate).getTime() === expected,
    o2.effectiveDate?.toISOString?.() ?? String(o2.effectiveDate));
  check("A all movements synced to same date", mv.length > 0 && mv.every((m) => m.effectiveDate && new Date(m.effectiveDate).getTime() === expected),
    `${mv.length} movements`);
  const { rows: [al] } = await db.query(
    `SELECT count(*)::int n FROM "AuditLog" WHERE action='EDIT_EFFECTIVE_DATE' AND "entityId"=$1`, [order.id]);
  check("A audit entry written", al.n >= 1, `count=${al.n}`);

  // B) future date blocked
  const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  res = await patch(order.id, { effectiveDate: tomorrow, reason: "smoke: future" });
  let bodyB = await res.json().catch(() => ({}));
  check("B future date → 409 future", res.status === 409 && /future/i.test(bodyB.error || ""), `status=${res.status} err="${bodyB.error}"`);

  // C) opname-freeze: insert an APPROVED opname for the location, then try to date before it
  const sessNum = `SMOKE-OPN-${Date.now()}`;
  await db.query(
    `INSERT INTO "OpnameSession" (id, "sessionNumber", "locationId", status, "approvedAt", "createdAt")
     VALUES ($1,$2,$3,'APPROVED', '2026-06-10T05:00:00Z', now())`,
    [`smoke_${Date.now()}`, sessNum, loc]);
  res = await patch(order.id, { effectiveDate: "2026-06-09", reason: "smoke: before count" });
  let bodyC = await res.json().catch(() => ({}));
  check("C date before approved opname → 409 freeze", res.status === 409 && /stock count/i.test(bodyC.error || ""), `status=${res.status} err="${bodyC.error}"`);
  res = await patch(order.id, { effectiveDate: "2026-06-11", reason: "smoke: after count" });
  check("C date after approved opname → 200", res.status === 200, `status=${res.status}`);

  // D) staff forbidden
  const staffRole = await login("staff@mitraramah.com", "staff123");
  res = await patch(order.id, { effectiveDate: "2026-06-05", reason: "smoke: staff" });
  check("D staff blocked → 403", res.status === 403, `loginRole=${staffRole} status=${res.status}`);

  // cleanup: remove temp opname, audit rows, and restore original effective dates
  await db.query(`DELETE FROM "OpnameSession" WHERE "sessionNumber"=$1`, [sessNum]);
  await db.query(`DELETE FROM "Movement" WHERE id=$1`, [smokeMvId]);
  await db.query(`DELETE FROM "AuditLog" WHERE action='EDIT_EFFECTIVE_DATE' AND "entityId"=$1`, [order.id]);
  await db.query(`UPDATE "Order" SET "effectiveDate"=$2 WHERE id=$1`, [order.id, origEffective]);
  console.log("cleanup done (temp opname + audit rows removed, dates restored)");

  await db.end();
  console.log(`\n${fail === 0 ? "✅ SMOKE PASSED" : "❌ SMOKE FAILED"} (${pass} passed, ${fail} failed)`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); try { await db.end(); } catch {} process.exit(1); });
