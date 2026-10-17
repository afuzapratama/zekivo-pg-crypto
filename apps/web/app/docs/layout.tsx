import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Brand } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { DocsNav } from "@/components/docs-nav";
import styles from "./docs.module.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Developers · Zekivo Pay",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <a href="#docs-content" className={styles.skip}>
        Lewati navigasi
      </a>
      <header className={styles.nav}>
        <div className="flex items-center gap-5">
          <Brand />
          <span className={styles.headerDivider} />
          <span className="text-sm text-muted-foreground">Developers</span>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/docs" className={styles.overview}>
            Panduan
          </Link>
          <Link href="/docs/playground" className={styles.overview}>
            Playground
          </Link>
          <Badge variant="secondary" className="gap-2">
            <span className="environment-dot" />
            {process.env.SOLANA_CLUSTER === "devnet" ? "Devnet" : "Sandbox"}
          </Badge>
          <Link href="/" className={styles.overview}>
            Overview <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </header>
      <div className={styles.workspace}>
        <DocsNav devnet={process.env.SOLANA_CLUSTER === "devnet"} />
        <main id="docs-content" className={styles.main}>
          {children}
          <footer className={styles.footer}>
            <span>© Zekivo · Payment infrastructure</span>
            <span>Solana · USDT &amp; USDC</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
