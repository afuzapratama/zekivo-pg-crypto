"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ReceiptText,
  BookOpen,
  Code2,
  Wallet,
  ArrowDownUp,
  FolderKey,
  ClipboardList,
  Bell,
  ShieldCheck,
  ArrowUpRight,
} from "lucide-react";
export default function Navigation() {
  const path = usePathname();
  const close = (event: React.MouseEvent) => {
    const details = event.currentTarget.closest("details");
    if (details) details.open = false;
  };
  return (
    <nav aria-label="Navigasi admin" className="space-y-7">
      <div>
        <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground">
          Workspace
        </p>
        <div className="space-y-1">
          {[
            {
              href: "/dashboard",
              label: "Overview",
              icon: LayoutDashboard,
              active: path === "/dashboard",
            },
            {
              href: "/dashboard/invoices",
              label: "Invoice",
              icon: ReceiptText,
              active: path.startsWith("/dashboard/invoices"),
            },
            {
              href: "/dashboard/transactions",
              label: "Transactions",
              icon: ArrowDownUp,
              active: path === "/dashboard/transactions",
            },
            {
              href: "/dashboard/reviews",
              label: "Review queue",
              icon: ClipboardList,
              active: path.startsWith("/dashboard/reviews"),
            },
            {
              href: "/dashboard/notifications",
              label: "Notifikasi",
              icon: Bell,
              active: path.startsWith("/dashboard/notifications"),
            },
            {
              href: "/dashboard/projects",
              label: "Projects",
              icon: FolderKey,
              active: path.startsWith("/dashboard/projects"),
            },
            {
              href: "/dashboard/monitoring",
              label: "Monitoring",
              icon: ShieldCheck,
              active: path === "/dashboard/monitoring",
            },
            {
              href: "/dashboard/wallet",
              label: "Wallet & scanner",
              icon: Wallet,
              active: path === "/dashboard/wallet",
            },
          ].map(({ href, label, icon: Icon, active }) => (
            <Link
              onClick={close}
              key={label}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              <Icon size={18} aria-hidden="true" />
              {label}
              {active && (
                <span className="ml-auto size-1.5 rounded-full bg-primary" />
              )}
            </Link>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground">
          Developer
        </p>
        <div className="space-y-1">
          {[
            { href: "/docs", label: "Dokumentasi", icon: BookOpen },
            { href: "/docs/api", label: "API reference", icon: Code2 },
          ].map(({ href, label, icon: Icon }) => (
            <Link
              onClick={close}
              key={href}
              href={href}
              className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Icon size={18} aria-hidden="true" />
              {label}
              <ArrowUpRight size={13} className="ml-auto" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
