import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Zekivo Pay · Developer workspace",
  description: "Solana payment infrastructure for Zekivo",
};
export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
