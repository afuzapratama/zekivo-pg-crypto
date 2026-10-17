import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { adminGet, type AdminSession } from "@/lib/admin";
import { Menu, ShieldCheck, ChevronRight, Layers3 } from "lucide-react";
import Logout from "./logout";
import Navigation from "./navigation";
export const dynamic = "force-dynamic";
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let session: AdminSession;
  try {
    session = await adminGet<AdminSession>("auth/session");
  } catch {
    redirect("/login");
  }
  if (!session.permissions.includes("dashboard:read")) redirect("/login");
  const cluster = process.env.SOLANA_CLUSTER ?? "localnet";
  const brand = (
    <Link
      href="/dashboard"
      className="flex min-h-11 items-center gap-3 text-lg font-semibold tracking-tight"
    >
      <span className="grid size-9 place-items-center rounded-[10px] bg-primary text-xl text-white">
        z.
      </span>
      zekivo <span className="font-normal text-muted-foreground">pay</span>
    </Link>
  );
  return (
    <div className="min-h-screen bg-[#f6f8fa]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-white lg:flex">
        <div className="flex h-20 items-center border-b px-6">{brand}</div>
        <div className="mx-4 my-6 flex items-center gap-3 rounded-xl border bg-muted/20 p-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg border bg-white">
            <Layers3 size={17} className="text-primary" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-semibold">Zekivo workspace</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Payment operations
            </p>
          </div>
        </div>
        <div className="px-4">
          <Navigation />
        </div>
        <div className="mt-auto p-4">
          <div className="rounded-xl border bg-muted/20 p-4">
            <div className="flex items-center gap-2 text-xs font-medium">
              <ShieldCheck
                size={16}
                className="text-primary"
                aria-hidden="true"
              />
              Akses internal
            </div>
            <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
              Session perusahaan · Hak akses sesuai peran.
            </p>
          </div>
          <p className="mt-4 px-2 text-[10px] text-muted-foreground">
            Zekivo Pay · Admin workspace
          </p>
        </div>
      </aside>
      <div className="min-w-0 lg:pl-60">
        <header className="sticky top-0 z-20 border-b bg-white/95 backdrop-blur-sm">
          <div className="flex min-h-20 flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-8">
            <div className="hidden items-center gap-2 text-xs text-muted-foreground lg:flex">
              <span>Workspace</span>
              <ChevronRight size={13} aria-hidden="true" />
              <span className="font-medium text-foreground">Pembayaran</span>
            </div>
            <div className="lg:hidden">{brand}</div>
            <div className="flex flex-wrap items-center gap-3">
              <Badge
                variant="outline"
                className="gap-2 rounded-md px-2.5 py-1.5"
              >
                <span
                  className="size-1.5 rounded-full bg-primary"
                  aria-hidden="true"
                />
                {cluster}
              </Badge>
              <div className="hidden h-6 border-l sm:block" />
              <div className="hidden items-center gap-2 sm:flex">
                <div className="grid size-8 place-items-center rounded-full bg-secondary text-[11px] font-semibold text-primary">
                  Z
                </div>
                <div>
                  <p className="text-xs font-medium">Operator Zekivo</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {session.role}
                  </p>
                </div>
              </div>
              <Logout csrf={session.csrf_token} />
            </div>
          </div>
          <details className="border-t lg:hidden">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-5 text-xs font-medium">
              <Menu size={16} aria-hidden="true" />
              Menu workspace
              <span className="ml-auto text-muted-foreground">
                {session.role}
              </span>
            </summary>
            <div className="border-t bg-white p-4">
              <Navigation />
            </div>
          </details>
        </header>
        <main
          id="overview"
          className="mx-auto max-w-[1500px] scroll-mt-28 px-5 py-7 sm:px-8 sm:py-9"
        >
          {children}
        </main>
        <footer className="mx-5 mt-8 flex flex-wrap items-center justify-between gap-2 border-t py-5 text-[10px] text-muted-foreground sm:mx-8">
          <span>Zekivo Pay · Payment operations</span>
          <span>
            {cluster === "devnet"
              ? "Solana Devnet · Dana pengujian"
              : "Solana · Workspace internal"}
          </span>
        </footer>
      </div>
    </div>
  );
}
