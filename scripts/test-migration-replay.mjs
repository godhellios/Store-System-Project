// Throwaway clean-replay test: create an empty Neon DB, run `prisma migrate deploy`
// into it (proving the chain replays from scratch), then drop it. Touches nothing real.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import pg from "pg";

// --- read the active (uncommented) DATABASE_URL from .env ---
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const line = env.split(/\r?\n/).find((l) => /^\s*DATABASE_URL\s*=/.test(l));
if (!line) throw new Error("No active DATABASE_URL in .env");
const baseUrl = line.replace(/^\s*DATABASE_URL\s*=\s*/, "").trim().replace(/^["']|["']$/g, "");

const u = new URL(baseUrl);
const adminUrl = new URL(baseUrl); // connect here to create/drop
adminUrl.pathname = "/neondb";
const scratchName = `migtest_${Date.now()}`;
const scratchUrl = new URL(baseUrl);
scratchUrl.pathname = `/${scratchName}`;

const admin = new pg.Client({ connectionString: adminUrl.toString() });

async function main() {
  await admin.connect();
  console.log(`Creating scratch database ${scratchName} on ${u.host} ...`);
  await admin.query(`CREATE DATABASE "${scratchName}"`);

  let ok = false;
  try {
    console.log("Running `prisma migrate deploy` into the empty DB ...\n");
    const res = spawnSync("npx prisma migrate deploy", {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: scratchUrl.toString(), DIRECT_URL: scratchUrl.toString() },
      stdio: "inherit",
      shell: true,
    });
    ok = res.status === 0;
  } finally {
    console.log(`\nDropping scratch database ${scratchName} ...`);
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [scratchName]
    );
    await admin.query(`DROP DATABASE IF EXISTS "${scratchName}"`);
    await admin.end();
  }

  console.log(ok ? "\n✅ CLEAN REPLAY SUCCEEDED" : "\n❌ CLEAN REPLAY FAILED");
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  try { await admin.query(`DROP DATABASE IF EXISTS "${scratchName}"`); await admin.end(); } catch {}
  process.exit(1);
});
