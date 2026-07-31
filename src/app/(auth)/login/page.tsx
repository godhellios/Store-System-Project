"use client";

import { useState, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/modules/i18n/provider";

function DisplacedBanner() {
  const searchParams = useSearchParams();
  const t = useT();
  if (searchParams.get("reason") !== "displaced") return null;
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm text-amber-700">
      {t("login.displaced", "Your session was replaced by a login from another device. Please sign in again.")}
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (res?.error) {
      if (res.error.startsWith("Account locked")) {
        setError(res.error);
      } else {
        setError(t("login.invalidCredentials", "Invalid email or password."));
      }
    } else {
      sessionStorage.setItem("captureLoginGeo", "1");
      sessionStorage.setItem("session_alive", "1");
      router.push("/dashboard");
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-8 space-y-6">
        {/* Logo */}
        <div className="text-center">
          <span className="text-3xl font-extrabold text-gray-800 tracking-tight">
            MR<span className="text-blue-600">Is</span>
          </span>
          <p className="mt-1 text-sm text-gray-500">{t("login.subtitle", "Mitra Ramah Inventory System")}</p>
        </div>

        <Suspense>
          <DisplacedBanner />
        </Suspense>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("login.email", "Email")}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="admin@mitraramah.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("login.password", "Password")}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold py-2 rounded-lg text-sm transition-colors"
          >
            {loading ? t("login.signingIn", "Signing in…") : t("login.signIn", "Sign in")}
          </button>
        </form>

        <div className="text-center space-y-1">
          <a
            href="/staff-guide.html"
            target="_blank"
            rel="noopener noreferrer"
            className="block text-xs text-blue-500 hover:text-blue-700 hover:underline"
          >
            📖 Staff Guide
          </a>
          <p className="text-xs text-gray-400">
            {t("login.footer", "© 2026 Mitra Ramah — MRIs v1.7.0")}
          </p>
        </div>
      </div>
    </div>
  );
}
