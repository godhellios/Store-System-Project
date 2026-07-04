// End-to-end smoke for the warehouse-change route. Exercises the REAL Next.js
// route via real NextAuth login — no mocks. Verifies DB side effects directly and
// restores every row it touches. Run against LOCAL dev (Neon) with the dev server
// on :3000. Quantities are integers (no timezone concerns).
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
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookieHeader() },
    body: new URLSearchParams({ csrfToken, email, password, callbackUrl: BASE, json: "true" }),
    redirect: "manual",
  });
  absorb(res);
  const sess = await (await fetch(`${BASE}/api/auth/session`, { headers: { Cookie: cookieHeader() } })).json();
  return sess?.user?.role ?? null;
}
const patch = (orderId, payload) =>
  fetch(`${BASE}/api/orders/${orderId}/warehouse`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader() },
    body: JSON.stringify(payload),
  });

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { (ok ? pass++ : fail++); console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`); };

// DB helpers
const stockOf = async (pid, loc) => {
  const { rows } = await db.query(`SELECT quantity FROM "Stock" WHERE "productId"=$1 AND "locationId"=$2`, [pid, loc]);
  return rows.length ? Number(rows[0].quantity) : 0;
};
const setStock = async (pid, loc, qty) => {
  await db.query(
    `INSERT INTO "Stock" (id,"productId","locationId",quantity,"updatedAt") VALUES ($1,$2,$3,$4,now())
     ON CONFLICT ("productId","locationId") DO UPDATE SET quantity=$4, "updatedAt"=now()`,
    [`smoke_${pid}_${loc}`.slice(0, 60), pid, loc, qty]);
};
const orderLoc = async (id) => (await db.query(`SELECT "fromLocationId" f, "toLocationId" t FROM "Order" WHERE id=$1`, [id])).rows[0];
const idByNumber = async (num) => (await db.query(`SELECT id FROM "Order" WHERE "orderNumber"=$1`, [num])).rows[0].id;
const linesOf = async (id) => (await db.query(`SELECT "productId", quantity FROM "OrderLine" WHERE "orderId"=$1`, [id])).rows;

async function main() {
  await db.connect();

  // Snapshot ALL stock + the 3 orders' locations, restore verbatim at the end.
  const stockSnap = (await db.query(`SELECT id,"productId","locationId",quantity FROM "Stock"`)).rows;
  const locs = Object.fromEntries((await db.query(`SELECT name,id FROM "Location"`)).rows.map((r) => [r.name, r.id]));
  const BIG = locs["Big Warehouse"], MED = locs["Medium Warehouse"], RET = locs["Retail Store"];

  const grnId = await idByNumber("GRN-SEED-0001");   // APPROVED GRN → Big
  const goutId = await idByNumber("GOUT-SEED-0001");  // APPROVED Goods Out from Big
  const trfId = await idByNumber("TRF-SEED-0001");    // APPROVED Transfer Big→Retail
  const orderSnap = {};
  for (const oid of [grnId, goutId, trfId]) orderSnap[oid] = await orderLoc(oid);

  const smokeMovId = `smoke_mv_${Date.now()}`;
  const opnameNum = `SMOKE-WH-${Date.now()}`;

  try {
    // ── A: admin moves an approved GRN's destination Big → Medium ─────────────
    const grnLines = await linesOf(grnId);
    // Guarantee Big has enough to reverse; start Medium from a known base.
    for (const l of grnLines) { await setStock(l.productId, BIG, Number(l.quantity) + 100); await setStock(l.productId, MED, 0); }
    // Synthetic movement to prove re-pointing (seed orders have none).
    await db.query(
      `INSERT INTO "Movement" (id,"orderId","orderLineId","productId","toLocationId",quantity,type,"createdAt")
       SELECT $1,$2,ol.id,ol."productId",$3,ol.quantity,'IN',now() FROM "OrderLine" ol WHERE ol."orderId"=$2 LIMIT 1`,
      [smokeMovId, grnId, BIG]);

    const role = await login("admin@mitraramah.com", "wirawan123");
    check("admin login", role === "ADMIN", `role=${role}`);

    const preBig = {}, preMed = {};
    for (const l of grnLines) { preBig[l.productId] = await stockOf(l.productId, BIG); preMed[l.productId] = await stockOf(l.productId, MED); }
    let res = await patch(grnId, { toLocationId: MED, reason: "smoke: wrong destination", confirm: true });
    check("A move GRN destination → 200", res.status === 200, `status=${res.status}`);

    let bigOk = true, medOk = true;
    for (const l of grnLines) {
      if (await stockOf(l.productId, BIG) !== preBig[l.productId] - Number(l.quantity)) bigOk = false;
      if (await stockOf(l.productId, MED) !== preMed[l.productId] + Number(l.quantity)) medOk = false;
    }
    check("A old warehouse (Big) decreased by line qty", bigOk);
    check("A new warehouse (Medium) increased by line qty", medOk);
    const mvTo = (await db.query(`SELECT "toLocationId" t FROM "Movement" WHERE id=$1`, [smokeMovId])).rows[0].t;
    check("A child movement re-pointed to new warehouse", mvTo === MED, `movement.to=${mvTo === MED ? "Medium" : mvTo}`);
    // audit is fire-and-forget in the route; poll briefly.
    let auditN = 0;
    for (let i = 0; i < 10 && auditN === 0; i++) {
      auditN = (await db.query(`SELECT count(*)::int n FROM "AuditLog" WHERE action='CHANGE_ORDER_WAREHOUSE' AND "entityId"=$1`, [grnId])).rows[0].n;
      if (!auditN) await new Promise((r) => setTimeout(r, 150));
    }
    check("A audit entry written", auditN >= 1, `count=${auditN}`);

    // ── B: moving a Goods Out onto a warehouse without stock → 409, no change ──
    const goutLines = await linesOf(goutId);
    for (const l of goutLines) await setStock(l.productId, MED, 0); // new source empty → must reject
    const preGoutFrom = (await orderLoc(goutId)).f;
    const preStockB = {};
    for (const l of goutLines) preStockB[l.productId] = { big: await stockOf(l.productId, BIG), med: await stockOf(l.productId, MED) };
    res = await patch(goutId, { fromLocationId: MED, reason: "smoke: negative", confirm: true });
    check("B new source would go negative → 409", res.status === 409, `status=${res.status}`);
    let unchanged = (await orderLoc(goutId)).f === preGoutFrom;
    for (const l of goutLines) {
      if (await stockOf(l.productId, BIG) !== preStockB[l.productId].big) unchanged = false;
      if (await stockOf(l.productId, MED) !== preStockB[l.productId].med) unchanged = false;
    }
    check("B rolled back — order + stock unchanged", unchanged);

    // ── C: opname freeze WARN + override on the Goods Out (Big → Retail) ───────
    for (const l of goutLines) await setStock(l.productId, RET, Number(l.quantity) + 100); // let the confirmed move succeed
    await db.query(
      `INSERT INTO "OpnameSession" (id,"sessionNumber","locationId",status,"approvedAt","createdAt")
       VALUES ($1,$2,$3,'APPROVED', now(), now())`, [`smoke_op_${Date.now()}`, opnameNum, BIG]);
    res = await patch(goutId, { fromLocationId: RET, reason: "smoke: opname" }); // no confirm
    let body = await res.json().catch(() => ({}));
    check("C opname warns without confirm (no change)", res.status === 200 && body.warning === "opname", `status=${res.status} warning=${body.warning}`);
    check("C order still at old source after warning", (await orderLoc(goutId)).f === BIG);
    res = await patch(goutId, { fromLocationId: RET, reason: "smoke: opname", confirm: true });
    check("C confirm overrides → 200 and applied", res.status === 200 && (await orderLoc(goutId)).f === RET, `status=${res.status}`);

    // ── D: transfer source == destination → 400 ───────────────────────────────
    res = await patch(trfId, { fromLocationId: RET, toLocationId: RET, reason: "smoke: same" });
    check("D transfer from == to → 400", res.status === 400, `status=${res.status}`);

    // ── E: staff forbidden ────────────────────────────────────────────────────
    const staffRole = await login("staff@mitraramah.com", "staff123");
    res = await patch(grnId, { toLocationId: BIG, reason: "smoke: staff" });
    check("E staff blocked → 403", res.status === 403, `loginRole=${staffRole} status=${res.status}`);
  } finally {
    // Restore: orders, stock (values + drop rows created during the run), temp rows.
    for (const [oid, loc] of Object.entries(orderSnap))
      await db.query(`UPDATE "Order" SET "fromLocationId"=$2, "toLocationId"=$3 WHERE id=$1`, [oid, loc.f, loc.t]);
    for (const s of stockSnap)
      await db.query(`UPDATE "Stock" SET quantity=$2 WHERE id=$1`, [s.id, s.quantity]);
    const keepIds = stockSnap.map((s) => s.id);
    await db.query(`DELETE FROM "Stock" WHERE id <> ALL($1::text[])`, [keepIds]);
    await db.query(`DELETE FROM "Movement" WHERE id=$1`, [smokeMovId]);
    await db.query(`DELETE FROM "OpnameSession" WHERE "sessionNumber"=$1`, [opnameNum]);
    await db.query(`DELETE FROM "AuditLog" WHERE action='CHANGE_ORDER_WAREHOUSE' AND "entityId"=ANY($1)`, [Object.keys(orderSnap)]);
    console.log("cleanup done (orders, stock, temp movement/opname/audit restored)");
    await db.end();
  }

  console.log(`\n${fail === 0 ? "✅ SMOKE PASSED" : "❌ SMOKE FAILED"} (${pass} passed, ${fail} failed)`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); try { await db.end(); } catch {} process.exit(1); });
