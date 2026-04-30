"use client";

import { SessionProvider } from "next-auth/react";
import { Toaster } from "react-hot-toast";
import { ThemeProvider } from "@/components/theme-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <SessionProvider>
        {children}
        <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
      </SessionProvider>
    </ThemeProvider>
  );
}
