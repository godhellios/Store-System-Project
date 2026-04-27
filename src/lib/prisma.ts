import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createPrismaClient() {
  const rawUrl = process.env.DATABASE_URL!;
  // Parse via WHATWG URL so percent-encoded chars in the password (e.g. %40 → @)
  // are decoded before being handed to pg — pg's own connection-string parser
  // does not reliably decode them.
  const u = new URL(rawUrl);
  const pool = new Pool({
    host: u.hostname,
    port: u.port ? parseInt(u.port) : 5432,
    user: u.username,
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, "") || "postgres",
    max: 1,
    ssl: rawUrl.includes("sslmode=disable") ? false : { rejectUnauthorized: false },
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
