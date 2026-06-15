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
  if (!session || session.user.error) redirect("/login");

  const role = session.user.role;
  if (allowed.length > 0 && !allowed.includes(role)) {
    redirect("/transactions/grn");
  }
  return session;
}

export async function blockOperator() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.error) redirect("/login");
  if (session.user.role === "OPERATOR") redirect("/transactions/grn");
  return session;
}

export async function blockViewer() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.error) redirect("/login");
  if (session.user.role === "VIEWER") redirect("/dashboard");
  return session;
}

// Reports are for oversight roles only: ADMIN + VIEWER.
// STAFF/OPERATOR are operational and don't need reporting.
export async function requireReportAccess() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.error) redirect("/login");
  const role = session.user.role;
  if (role === "ADMIN" || role === "VIEWER") return session;
  if (role === "OPERATOR") redirect("/transactions/grn");
  redirect("/dashboard");
}

export async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.error) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");
  return session;
}

// For API route handlers — returns a 401/403 response object or null.
// Usage: const guard = viewerGuard(session); if (guard) return guard;
import { NextResponse } from "next/server";
export function viewerGuard(session: { user: { role: string; error?: string } }) {
  if (session.user.error)
    return NextResponse.json({ error: "Session expired. Please log in again." }, { status: 401 });
  if (session.user.role === "VIEWER")
    return NextResponse.json({ error: "Viewers have read-only access" }, { status: 403 });
  return null;
}
