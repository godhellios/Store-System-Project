import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Upstash Redis rate limiters — falls back to no-op if env vars are missing (e.g. local dev without Redis)
function makeRatelimit(max: number, window: `${number} ${"s" | "m" | "h"}`) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Ratelimit({ redis: new Redis({ url, token }), limiter: Ratelimit.slidingWindow(max, window) });
}

const loginLimiter   = makeRatelimit(20,  "5 m");
const orderLimiter   = makeRatelimit(60,  "1 m");
const barcodeLimiter = makeRatelimit(300, "1 m");

// In-memory fallback (used when Upstash env vars are not set)
type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();
function allowLocal(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const win = windows.get(key);
  if (!win || win.resetAt <= now) { windows.set(key, { count: 1, resetAt: now + windowMs }); return true; }
  if (win.count >= max) return false;
  win.count++;
  return true;
}

async function checkLimit(limiter: Ratelimit | null, key: string, localMax: number, localWindowMs: number): Promise<boolean> {
  if (limiter) {
    const { success } = await limiter.limit(key);
    return success;
  }
  return allowLocal(key, localMax, localWindowMs);
}

function ip(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const clientIp = ip(request);

  // ── Rate limiting ──────────────────────────────────────────────────────────
  if (pathname === "/api/auth/callback/credentials") {
    if (!await checkLimit(loginLimiter, `login:${clientIp}`, 20, 5 * 60 * 1000))
      return NextResponse.json({ error: "Too many login attempts — try again later" }, { status: 429 });
  } else if (pathname === "/api/orders" && request.method === "POST") {
    if (!await checkLimit(orderLimiter, `order:${clientIp}`, 60, 60 * 1000))
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  } else if (pathname.startsWith("/api/barcodes/")) {
    if (!await checkLimit(barcodeLimiter, `barcode:${clientIp}`, 300, 60 * 1000))
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  // ── Session guard ──────────────────────────────────────────────────────────
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/staff-guide.html";

  if (isPublic) return NextResponse.next();

  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      return NextResponse.redirect(new URL("/login", request.url));
    }
    // Session invalidated by periodic DB check (user deactivated, locked, or displaced)
    if (token.error) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Session expired. Please log in again." }, { status: 401 });
      }
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("error", "SessionExpired");
      return NextResponse.redirect(url);
    }
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
