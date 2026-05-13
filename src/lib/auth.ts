import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// Set to true to re-enable these roles
const ROLES_ENABLED = { OPERATOR: false, VIEWER: false };

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user || !user.isActive) return null;

        // Check if account is temporarily locked
        if (user.lockedUntil && user.lockedUntil > new Date()) {
          const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
          throw new Error(`Account locked due to too many failed attempts. Try again in ${minutesLeft} minute${minutesLeft !== 1 ? "s" : ""}.`);
        }

        const valid = await bcrypt.compare(credentials.password, user.password);
        if (!valid) {
          const attempts = (user.failedLoginAttempts ?? 0) + 1;
          const lockout = attempts >= 5;
          await prisma.user.update({
            where: { id: user.id },
            data: {
              failedLoginAttempts: attempts,
              lockedUntil: lockout ? new Date(Date.now() + 15 * 60 * 1000) : null,
            },
          });
          return null;
        }

        if (!ROLES_ENABLED[user.role as keyof typeof ROLES_ENABLED] && user.role in ROLES_ENABLED)
          throw new Error("This role is currently disabled. Please contact your administrator.");

        // Successful login — reset lockout counters
        if (user.failedLoginAttempts > 0 || user.lockedUntil) {
          await prisma.user.update({
            where: { id: user.id },
            data: { failedLoginAttempts: 0, lockedUntil: null },
          }).catch(() => {});
        }

        const rawIp = (req.headers?.["x-forwarded-for"] ?? req.headers?.["x-real-ip"] ?? null) as string | null;
        const ip = rawIp ? rawIp.split(",")[0].trim() : null;
        const userAgent = (req.headers?.["user-agent"] ?? null) as string | null;
        prisma.loginLog.create({
          data: { userId: user.id, userName: user.name, email: user.email, ip, userAgent },
        }).catch(() => {});

        // Stamp a new session ID so any previous session on another device is invalidated
        const sessionId = crypto.randomUUID();
        if (user.role !== "ADMIN") {
          prisma.user.update({
            where: { id: user.id },
            data: { activeSessionId: sessionId },
          }).catch(() => {});
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          sessionId,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as unknown as { role: string; sessionId: string }).role;
        if ((user as unknown as { role: string }).role !== "ADMIN") {
          token.loginAt = Date.now();
          token.sessionId = (user as unknown as { sessionId: string }).sessionId;
        }
        token.checkedAt = Date.now();
        return token;
      }

      // Periodic re-validation every 5 minutes
      const CHECK_INTERVAL_MS = 5 * 60 * 1000;
      if (Date.now() - ((token.checkedAt as number | undefined) ?? 0) < CHECK_INTERVAL_MS) {
        return token;
      }

      try {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { isActive: true, lockedUntil: true, activeSessionId: true, role: true },
        });

        if (!dbUser || !dbUser.isActive || (dbUser.lockedUntil && dbUser.lockedUntil > new Date())) {
          token.error = "SessionInvalid";
          return token;
        }

        // Non-ADMIN: check if this session was displaced by a newer login on another device
        if (dbUser.role !== "ADMIN" && token.sessionId && dbUser.activeSessionId !== (token.sessionId as string)) {
          token.error = "SessionDisplaced";
          return token;
        }

        delete token.error;
        token.checkedAt = Date.now();
      } catch {
        // DB unavailable — do not invalidate; retry on next request
      }

      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        if (token.loginAt) session.user.loginAt = token.loginAt as number;
        if (token.sessionId) session.user.sessionId = token.sessionId as string;
        if (token.error) session.user.error = token.error as string;
      }
      return session;
    },
  },
};
