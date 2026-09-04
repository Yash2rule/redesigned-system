import type { Metadata } from "next";
import type { ReactNode } from "react";
import { config } from "../lib/config.ts";
import "./globals.css";

export const metadata: Metadata = {
  title: `${config.name} — ${config.tagline}`,
  description: config.subheadline,
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
