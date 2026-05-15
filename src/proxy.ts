import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Sliding-window rate limiter (per Edge worker instance).
// Sufficient for single-region deployments; swap hitStore for Upstash Redis
// if multi-region distributed rate limiting is ever needed.
// ---------------------------------------------------------------------------

const hitStore = new Map<string, number[]>();

function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const prev = (hitStore.get(key) ?? []).filter((t) => now - t < windowMs);
  if (prev.length >= limit) return true;
  hitStore.set(key, [...prev, now]);
  return false;
}

interface RateRule {
  pattern: RegExp;
  method?: string;
  limit: number;
  windowMs: number;
}

// Limits are per-IP. The office may share one NAT IP across several staff,
// so limits are set generously to avoid false positives on legitimate traffic.
const RATE_RULES: RateRule[] = [
  // Login — 20 attempts per IP per 5 min.
  // Per-account lockout (5 bad passwords → 15 min) is the primary brute-force
  // guard; this covers IP-level spraying across many accounts.
  { pattern: /^\/api\/auth\/signin$/, limit: 20, windowMs: 5 * 60 * 1000 },

  // Order creation — 60 per IP per minute.
  { pattern: /^\/api\/orders$/, method: "POST", limit: 60, windowMs: 60 * 1000 },

  // Barcode / SKU lookup — 300 per IP per minute (5 scans/sec across all staff).
  { pattern: /^\/api\/products\/lookup$/, limit: 300, windowMs: 60 * 1000 },
];

// ---------------------------------------------------------------------------

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  // 1. Rate limiting — runs before session validation.
  for (const rule of RATE_RULES) {
    if (rule.pattern.test(pathname) && (!rule.method || request.method === rule.method)) {
      if (isRateLimited(`${ip}:${rule.pattern.source}`, rule.limit, rule.windowMs)) {
        return NextResponse.json(
          { error: "Too many requests. Please slow down and try again." },
          { status: 429, headers: { "Retry-After": "60" } },
        );
      }
      break;
    }
  }

  // 2. Session guard — /api/auth/* and /login are public; everything else
  //    requires a valid, non-invalidated JWT.
  try {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });
    if (!token) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    // Session invalidated by periodic DB check (user deactivated, locked, or displaced)
    if (token.error) {
      if (request.nextUrl.pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "Session expired. Please log in again." },
          { status: 401 }
        );
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
  matcher: [
    // Rate-limited auth endpoint (excluded from the broad pattern below).
    "/api/auth/signin",
    // All app routes except static assets, the login page, and other auth endpoints.
    "/((?!login|api/auth|_next/static|_next/image|favicon.ico|staff-guide.html).*)",
  ],
};
