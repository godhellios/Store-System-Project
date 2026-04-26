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
