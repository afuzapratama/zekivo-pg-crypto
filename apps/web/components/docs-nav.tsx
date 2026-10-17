"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Code2,
  FlaskConical,
  Webhook,
  Wallet,
  ArrowUpRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import styles from "@/app/docs/docs.module.css";
const links = [
  { href: "/docs", label: "Mulai integrasi", icon: BookOpen },
  { href: "/docs/api", label: "API reference", icon: Code2 },
  { href: "/docs/playground", label: "Payment playground", icon: FlaskConical },
  { href: "/docs#webhooks", label: "Webhook", icon: Webhook },
  { href: "/docs/devnet", label: "Solana Devnet", icon: Wallet },
];
export function DocsNav({ devnet = false }: { devnet?: boolean }) {
  const pathname = usePathname();
  return (
    <aside className={styles.sidebar}>
      <p className={styles.navCaption}>DEVELOPER WORKSPACE</p>
      <nav aria-label="Dokumentasi" className={styles.sideLinks}>
        {links.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={pathname === href ? "page" : undefined}
            className={cn(styles.sideLink, pathname === href && styles.active)}
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </Link>
        ))}
      </nav>
      <div className={styles.sideNote}>
        <span className="environment-dot" />{" "}
        {devnet ? "Devnet · USDC test" : "Localnet sandbox"}
        <p>
          {devnet
            ? "Invoice USDC Circle, pembayaran melalui Phantom."
            : "Uji seluruh alur dengan mock token, tanpa dana asli."}
        </p>
        <Link href={devnet ? "/docs/devnet" : "/docs/playground"}>
          {devnet ? "Panduan wallet" : "Buka playground"}{" "}
          <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </aside>
  );
}
