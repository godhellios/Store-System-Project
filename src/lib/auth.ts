import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

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

        const valid = await bcrypt.compare(credentials.password, user.password);
        if (!valid) return null;

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
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        if (token.loginAt) session.user.loginAt = token.loginAt as number;
        if (token.sessionId) session.user.sessionId = token.sessionId as string;
      }
      return session;
    },
  },
};
