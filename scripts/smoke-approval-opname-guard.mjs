// End-to-end smoke for the APPROVAL-time opname guard.
//
// A pending order has its date checked when it is ENTERED, but its stock moves
// when an admin APPROVES it — days later. Two rules are re-checked at approval:
//   1. a count in progress covering these goods → hard block, not overridable;
//   2. an approved count on a LATER day than the order → warn once; on confirm
//      the stock applies and the order is re-dated to now, so the completed
//      count is never rewritten from behind.
//
// Exercises the REAL route via real NextAuth login. Restores stock and deletes
// everything it creates. Run against LOCAL dev (Neon) only, dev server on :3000.
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
  absorb(await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookieHeader() },
    body: new URLSearchParams({ csrfToken, email, password, callbackUrl: BASE, json: "true" }),
    redirect: "manual",
  }));
  const sess = await (await fetch(`${BASE}/api/auth/session`, { headers: { Cookie: cookieHeader() } })).json();
  return sess?.user?.role ?? null;
}
const api = (method, path, body) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookieHeader() },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

const dayStr = (n) => new Date(Date.now() - n * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { (ok ? pass++ : fail++); console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`); };

const createdOrders = [];
const createdSessions = [];

async function main() {
  await db.connect();
  check("admin login", (await login("admin@mitraramah.com", "wirawan123")) === "ADMIN");

  // A product/location with no approved count, so we control the whole timeline.
  const { rows: [pick] } = await db.query(`
    SELECT s."productId", s."locationId", s.quantity, p.name
    FROM "Stock" s JOIN "Product" p ON p.id = s."productId"
    WHERE p."isActive" = true AND s.quantity > 10
      AND s."locationId" NOT IN (SELECT DISTINCT "locationId" FROM "OpnameSession" WHERE status='APPROVED')
    ORDER BY s.quantity DESC LIMIT 1`);
  if (!pick) throw new Error("no suitable stock row found");
  const { productId, locationId } = pick;
  const Q0 = Number(pick.quantity);
  console.log(`Using "${pick.name}" @ ${locationId} — starting qty ${Q0}`);
  const stockNow = async () =>
    Number((await db.query(`SELECT quantity FROM "Stock" WHERE "productId"=$1 AND "locationId"=$2`, [productId, locationId])).rows[0].quantity);

  const newAdjustment = async (effectiveDate) => {
    const res = await api("POST", "/api/orders", {
      type: "ADJUSTMENT", toLocationId: locationId, adjustmentReason: "Guard smoke",
      ...(effectiveDate ? { effectiveDate } : {}),
      lines: [{ productId, quantity: 2 }], // +2: an addition can never fail a stock check
    });
    const data = await res.json();
    if (data.order) createdOrders.push(data.order.id);
    return { status: res.status, data };
  };
  const addSession = async (status, { countDate = null, approvedAt = null } = {}) => {
    const id = `smokeguard_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await db.query(
      `INSERT INTO "OpnameSession" (id,"sessionNumber","locationId",status,"countDate","approvedAt","createdAt")
       VALUES ($1,$2,$3,$4::"OpnameStatus",$5,$6,now())`,
      [id, `SMOKE-GUARD-${id.slice(-6)}`, locationId, status, countDate, approvedAt]);
    createdSessions.push(id);
    return id;
  };

  // ── Rule 2: approved count on a LATER day than the order ───────────────────
  // Order dated 6 days ago, count dated 3 days ago → approving would rewrite
  // history behind a settled count.
  let { status, data } = await newAdjustment(dayStr(6));
  check("setup: backdated pending adjustment created", status === 201, `status=${status} err="${data.error}"`);
  const staleId = data.order?.id;
  const countSession = await addSession("APPROVED", { approvedAt: daysAgo(3) });

  const before = await stockNow();
  let r = await api("PATCH", `/api/orders/${staleId}`, { action: "approve" });
  let body = await r.json();
  check("WARN: approve returns the opname warning", r.status === 200 && body.warning === "opname",
    `status=${r.status} body=${JSON.stringify(body)}`);
  check("WARN: stock NOT changed while unconfirmed", (await stockNow()) === before, `${before} → ${await stockNow()}`);
  const stillPending = (await db.query(`SELECT "adjustmentStatus" st FROM "Order" WHERE id=$1`, [staleId])).rows[0];
  check("WARN: order still PENDING", stillPending.st === "PENDING", `status=${stillPending.st}`);

  // Confirm → applies AND re-dates so the completed count stays intact.
  r = await api("PATCH", `/api/orders/${staleId}`, { action: "approve", confirm: true });
  body = await r.json();
  check("CONFIRM: approved", r.status === 200 && body.success === true, `status=${r.status} body=${JSON.stringify(body)}`);
  check("CONFIRM: +2 applied", (await stockNow()) === before + 2, `${before} → ${await stockNow()}`);
  const after = (await db.query(
    `SELECT "adjustmentStatus" st, "effectiveDate" ed FROM "Order" WHERE id=$1`, [staleId])).rows[0];
  check("CONFIRM: order APPROVED", after.st === "APPROVED", `status=${after.st}`);
  const redatedToday = new Date(after.ed).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }) === dayStr(0);
  check("CONFIRM: order re-dated to today (count not rewritten)", redatedToday, `effectiveDate=${after.ed}`);
  const mvDates = (await db.query(
    `SELECT DISTINCT to_char("effectiveDate" AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD') d FROM "Movement" WHERE "orderId"=$1`, [staleId])).rows;
  check("CONFIRM: movements re-dated too", mvDates.length === 1 && mvDates[0].d === dayStr(0),
    `movement days=${JSON.stringify(mvDates.map((m) => m.d))}`);

  const auditRedate = (await db.query(
    `SELECT description FROM "AuditLog" WHERE "entityId"=$1 AND action='APPROVE_ADJUSTMENT'`, [staleId])).rows[0];
  check("CONFIRM: override recorded in the audit log", /re-dated to/i.test(auditRedate?.description ?? ""),
    `desc="${auditRedate?.description}"`);

  await db.query(`DELETE FROM "OpnameSession" WHERE id=$1`, [countSession]);

  // ── Rule 1: a count IN PROGRESS → hard block, not overridable ──────────────
  ({ status, data } = await newAdjustment(null));
  check("setup: second pending adjustment created", status === 201, `status=${status} err="${data.error}"`);
  const blockedId = data.order?.id;
  const openSession = await addSession("IN_PROGRESS");

  const beforeBlock = await stockNow();
  r = await api("PATCH", `/api/orders/${blockedId}`, { action: "approve" });
  body = await r.json();
  check("BLOCK: approve during an open count → 409", r.status === 409 && /open stock count/i.test(body.error ?? ""),
    `status=${r.status} err="${body.error}"`);
  r = await api("PATCH", `/api/orders/${blockedId}`, { action: "approve", confirm: true });
  body = await r.json();
  check("BLOCK: confirm cannot override an open count → 409", r.status === 409,
    `status=${r.status} err="${body.error}"`);
  check("BLOCK: stock untouched", (await stockNow()) === beforeBlock, `${beforeBlock} → ${await stockNow()}`);

  // Close the count → the same approval now succeeds.
  await db.query(`DELETE FROM "OpnameSession" WHERE id=$1`, [openSession]);
  r = await api("PATCH", `/api/orders/${blockedId}`, { action: "approve" });
  body = await r.json();
  check("BLOCK: approves normally once the count is closed", r.status === 200 && body.success === true,
    `status=${r.status} body=${JSON.stringify(body)}`);
  check("BLOCK: +2 applied after the count closed", (await stockNow()) === beforeBlock + 2, `${beforeBlock} → ${await stockNow()}`);

  // Rejecting is never gated by a count.
  ({ status, data } = await newAdjustment(dayStr(6)));
  const rejectId = data.order?.id;
  const rejSession = await addSession("IN_PROGRESS");
  r = await api("PATCH", `/api/orders/${rejectId}`, { action: "reject", note: "smoke" });
  check("REJECT: allowed even during an open count", r.status === 200, `status=${r.status}`);
  await db.query(`DELETE FROM "OpnameSession" WHERE id=$1`, [rejSession]);

  // ── cleanup ────────────────────────────────────────────────────────────────
  if (createdSessions.length)
    await db.query(`DELETE FROM "OpnameSession" WHERE id = ANY($1::text[])`, [createdSessions]);
  if (createdOrders.length) {
    await db.query(`DELETE FROM "Movement" WHERE "orderId" = ANY($1::text[])`, [createdOrders]);
    await db.query(`DELETE FROM "OrderLine" WHERE "orderId" = ANY($1::text[])`, [createdOrders]);
    await db.query(`DELETE FROM "AuditLog" WHERE "entityId" = ANY($1::text[])`, [createdOrders]);
    await db.query(`DELETE FROM "Order" WHERE id = ANY($1::text[])`, [createdOrders]);
  }
  await db.query(`UPDATE "Stock" SET quantity=$3 WHERE "productId"=$1 AND "locationId"=$2`, [productId, locationId, Q0]);
  check("cleanup: stock restored to starting qty", (await stockNow()) === Q0, `${await stockNow()} vs ${Q0}`);

  await db.end();
  console.log(`\n${fail === 0 ? "✅ SMOKE PASSED" : "❌ SMOKE FAILED"} (${pass} passed, ${fail} failed)`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); try { await db.end(); } catch {} process.exit(1); });
