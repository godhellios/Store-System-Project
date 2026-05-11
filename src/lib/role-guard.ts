import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";

export const OPERATOR_ALLOWED = [
  "/dashboard",
  "/transactions/grn",
  "/transactions/goods-out",
  "/transactions/transfer",
];

export async function requireRole(...allowed: string[]) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const role = session.user.role;
  if (allowed.length > 0 && !allowed.includes(role)) {
    redirect("/transactions/grn");
  }
  return session;
}

export async function blockOperator() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (session.user.role === "OPERATOR") redirect("/transactions/grn");
  return session;
}

export async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");
  return session;
}

// For API route handlers — returns a 403 response object when the caller is VIEWER.
// Usage: const guard = viewerGuard(session); if (guard) return guard;
import { NextResponse } from "next/server";
export function viewerGuard(session: { user: { role: string } }) {
  if (session.user.role === "VIEWER")
    return NextResponse.json({ error: "Viewers have read-only access" }, { status: 403 });
  return null;
}
