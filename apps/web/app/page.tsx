import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Code2,
  FlaskConical,
  Webhook,
  ShieldCheck,
  Blocks,
  Check,
  ChevronRight,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
export const dynamic = "force-dynamic";
export default function Home() {
  if (
    process.env.APP_ENV === "staging" &&
    process.env.SOLANA_CLUSTER === "devnet"
  )
    redirect("/docs/devnet");
  return (
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <nav
          aria-label="Navigasi utama"
          className="mx-auto flex min-h-20 max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-10"
        >
          <Brand />
          <div className="flex items-center gap-2 sm:gap-5">
            <Link className="p-2 text-sm text-muted-foreground" href="/docs">
              Dokumentasi
            </Link>
            <Button asChild variant="outline" className="min-h-11">
              <Link href="/docs/playground">
                Playground <ArrowUpRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-5 pb-8 sm:px-10">
        <section className="grid items-center gap-10 py-14 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:py-24">
          <div>
            <Badge
              variant="outline"
              className="gap-2 bg-white py-1.5 font-normal"
            >
              <span className="environment-dot" />
              Developer preview · Localnet
            </Badge>
            <h1 className="mt-7 text-4xl font-semibold leading-[1.08] tracking-[-1.8px] sm:text-5xl lg:text-6xl">
              Pembayaran crypto.
              <br />
              <span className="text-primary">Alur yang jelas.</span>
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground">
              Satu integrasi untuk menerima USDT dan USDC di Solana. Buat
              invoice, arahkan ke checkout, dan proses pesanan setelah
              pembayaran terverifikasi.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild className="min-h-11 px-5">
                <Link href="/docs/playground">
                  Coba payment playground <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="min-h-11 px-5">
                <Link href="/docs/api">
                  Jelajahi API <Code2 aria-hidden="true" />
                </Link>
              </Button>
            </div>
            <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck size={15} aria-hidden="true" />
              Mock token lokal. Tidak memerlukan dana asli.
            </p>
          </div>
          <div className="overflow-hidden rounded-2xl border bg-white shadow-[0_12px_48px_-24px_#17232b40]">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <span className="flex items-center gap-2 text-xs font-medium">
                <Code2 size={15} aria-hidden="true" />
                Buat invoice
              </span>
              <Badge variant="secondary" className="font-mono text-[10px]">
                POST /v1/invoices
              </Badge>
            </div>
            <div className="bg-[#152329] p-6 text-[13px] leading-7 text-[#d7e8e1]">
              <p className="mb-3 text-[#9bb5ac]">
                // Contoh request dari backend merchant
              </p>
              <pre className="overflow-auto">{`{\n  "order_id": "zekivo-order-001",\n  "asset": "USDC",\n  "amount": "25"\n}`}</pre>
            </div>
            <div className="space-y-4 p-5">
              {[
                ["01", "Buat invoice", "API idempotent"],
                ["02", "Bayar melalui checkout", "QR & transfer manual"],
                ["03", "Verifikasi & webhook", "Finalized di Solana"],
              ].map(([n, title, caption]) => (
                <div key={n} className="flex items-center gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-primary">
                    {n}
                  </span>
                  <span className="text-xs font-medium">{title}</span>
                  <span className="ml-auto text-right text-[10px] text-muted-foreground">
                    {caption}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
        <div className="flex flex-wrap items-center gap-6 border-y py-5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            Dibangun untuk ekosistem Zekivo
          </span>
          <span className="flex items-center gap-2">
            <Check size={14} className="text-primary" aria-hidden="true" />
            Solana
          </span>
          <span>USDT + USDC</span>
          <span>Watch-only receiving</span>
          <span>Signed webhooks</span>
        </div>
        <section className="py-12">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold tracking-[2px] text-primary">
                DEVELOPER TOOLKIT
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight">
                Dari request pertama ke pembayaran.
              </h2>
            </div>
            <Link
              href="/docs"
              className="flex min-h-11 items-center gap-1 text-xs font-medium text-primary"
            >
              Baca panduan integrasi{" "}
              <ChevronRight size={15} aria-hidden="true" />
            </Link>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {[
              {
                icon: Code2,
                title: "API reference",
                text: "Telusuri endpoint, schema, dan contoh request dari kontrak OpenAPI gateway.",
                href: "/docs/api",
                action: "Jelajahi endpoint",
              },
              {
                icon: FlaskConical,
                title: "Payment playground",
                text: "Generate invoice dan uji skenario pembayaran sampai webhook diterima.",
                href: "/docs/playground",
                action: "Mulai pengujian",
              },
              {
                icon: Webhook,
                title: "Webhook yang terverifikasi",
                text: "Integrasikan signature HMAC, retry, dan pemrosesan order yang idempotent.",
                href: "/docs#webhooks",
                action: "Panduan webhook",
              },
            ].map(({ icon: Icon, title, text, href, action }) => (
              <Card key={title} className="shadow-none">
                <CardContent className="p-6">
                  <span className="inline-flex rounded-lg border bg-background p-2.5 text-primary">
                    <Icon size={20} aria-hidden="true" />
                  </span>
                  <h3 className="mt-5 text-base font-semibold">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {text}
                  </p>
                  <Link
                    href={href}
                    className="mt-5 flex min-h-11 items-center gap-2 text-xs font-medium text-primary"
                  >
                    {action}
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
        <div className="flex items-start gap-3 rounded-xl border bg-white p-5">
          <Blocks
            className="mt-0.5 shrink-0 text-muted-foreground"
            size={19}
            aria-hidden="true"
          />
          <p className="text-xs leading-6 text-muted-foreground">
            <strong className="font-semibold text-foreground">
              Sandbox aktif, Devnet dalam persiapan.
            </strong>{" "}
            Gateway saat ini memproses mock token localnet. Akun penerima USDC
            Devnet sudah disiapkan; pengujian invoice Devnet dan Mainnet belum
            diaktifkan.
          </p>
        </div>
        <footer className="mt-12 flex flex-wrap justify-between gap-3 border-t py-6 text-[11px] text-muted-foreground">
          <span>© Zekivo · Payment infrastructure</span>
          <span>Built for a verifiable payment flow.</span>
        </footer>
      </main>
    </div>
  );
}
