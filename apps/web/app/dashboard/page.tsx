import RefreshButton from "./refresh-button";
import {
  ReceiptText,
  CircleCheck,
  Clock3,
  Hourglass,
  CalendarClock,
  ShieldAlert,
  Coins,
  ArrowDownLeft,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  adminGet,
  AdminApiError,
  dateTime,
  tokenLabel,
  type Overview,
  type Project,
} from "@/lib/admin";
export const dynamic = "force-dynamic";
export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  const query = new URLSearchParams();
  for (const name of ["project_id"]) {
    const value = search[name];
    if (typeof value === "string" && value) query.set(name, value);
  }
  const projectQuery = query.get("project_id")
    ? `?project_id=${encodeURIComponent(query.get("project_id")!)}`
    : "";
  let overview: Overview, projects: { items: Project[] };
  try {
    [overview, projects] = await Promise.all([
      adminGet<Overview>(`overview${projectQuery}`),
      adminGet<{ items: Project[] }>("projects"),
    ]);
  } catch (error) {
    if (!(error instanceof AdminApiError)) throw error;
    return (
      <div className="rounded-xl border bg-white p-7">
        <h1 className="text-2xl font-semibold">
          Dashboard belum dapat ditampilkan.
        </h1>
        <p role="alert" className="my-4 text-muted-foreground">
          {error instanceof AdminApiError && error.status === 400
            ? "Filter atau halaman sudah tidak valid. Kembali ke daftar awal."
            : "Data pembayaran belum dapat diambil. Muat ulang untuk mencoba lagi."}
        </p>
        <Button asChild>
          <Link href="/dashboard">Muat dashboard</Link>
        </Button>
      </div>
    );
  }
  const selectClass = "min-h-11 w-full rounded-md border bg-white px-3 text-sm";
  const statIcons = [
    ReceiptText,
    CircleCheck,
    Clock3,
    Hourglass,
    CalendarClock,
    ShieldAlert,
  ];
  const statHints = [
    "Seluruh invoice",
    "Finalized",
    "Belum dibayar",
    "Menunggu finality",
    "Melewati batas waktu",
    "Perlu pemeriksaan",
  ];
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight sm:text-3xl">
            Overview pembayaran.
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Seluruh periode · {overview.environment} / {overview.cluster} ·
            Waktu WIB
          </p>
        </div>
        <RefreshButton />
      </div>
      <form
        method="get"
        action="/dashboard"
        className="my-6 flex flex-wrap items-end gap-3"
      >
        <label className="w-full space-y-2 text-sm sm:w-72">
          Project
          <select
            name="project_id"
            aria-label="Project"
            defaultValue={query.get("project_id") ?? ""}
            className={selectClass}
          >
            <option value="">Semua project</option>
            {projects.items.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit">Terapkan project</Button>
        <Button variant="outline" asChild>
          <Link href={`/dashboard/invoices${projectQuery}`}>Lihat invoice</Link>
        </Button>
      </form>
      <section
        aria-label="Ringkasan invoice"
        className="my-7 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
      >
        {[
          ["Total invoice", "total"],
          ["Paid", "paid"],
          ["Pending", "pending"],
          ["Confirming", "confirming"],
          ["Expired", "expired"],
          ["Perlu review", "review"],
        ].map(([label, key], index) => {
          const Icon = statIcons[index]!;
          return (
            <Card className="shadow-none" key={key}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-[11px] font-medium text-muted-foreground">
                    {label}
                  </h2>
                  <Icon
                    size={15}
                    className={
                      key === "paid" ? "text-primary" : "text-muted-foreground"
                    }
                    aria-hidden="true"
                  />
                </div>
                <p className="mt-3 text-3xl font-semibold tabular-nums">
                  {overview.counts[key]}
                </p>
                <p className="mt-3 text-[10px] leading-5 text-muted-foreground">
                  {statHints[index]}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </section>
      <section
        aria-label="Penerimaan terverifikasi"
        className="mb-8 grid gap-4 sm:grid-cols-2"
      >
        {overview.gross_received.map((row) => (
          <Card
            className={`relative overflow-hidden shadow-none ${row.asset === "USDT" ? "border-[#174b40] bg-[#174b40] text-white" : "bg-white"}`}
            key={row.asset}
          >
            <CardContent className="relative p-6">
              <div className="mb-5 flex items-center justify-between">
                <span
                  className={`grid size-10 place-items-center rounded-xl border ${row.asset === "USDT" ? "border-white/20 bg-white/10" : "bg-secondary"}`}
                >
                  <Coins size={20} aria-hidden="true" />
                </span>
                <span
                  className={`flex items-center gap-1.5 text-[10px] ${row.asset === "USDT" ? "text-white/80" : "text-muted-foreground"}`}
                >
                  <ArrowDownLeft size={13} aria-hidden="true" />
                  LEDGER PAYMENT
                </span>
              </div>
              <h2 className="text-sm font-medium">
                Penerimaan bruto · {tokenLabel(row.asset, overview.cluster)}
              </h2>
              <p className="mt-3 break-all text-2xl font-semibold tabular-nums">
                {row.amount}{" "}
                <span
                  className={`text-sm font-normal ${row.asset === "USDT" ? "text-white/80" : "text-muted-foreground"}`}
                >
                  {tokenLabel(row.asset, overview.cluster)}
                </span>
              </p>
              <p
                className={`mt-2 text-[11px] leading-6 ${row.asset === "USDT" ? "text-white/80" : "text-muted-foreground"}`}
              >
                Kredit pembayaran pada ledger. Bukan saldo wallet atau nilai
                fiat.
              </p>
            </CardContent>
          </Card>
        ))}
      </section>
      <Card className="shadow-none">
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold">Ruang kerja operasional</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Pilih halaman untuk memeriksa pembayaran dan kondisi gateway.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            {[
              ["/dashboard/invoices", "Invoice"],
              ["/dashboard/transactions", "Transactions"],
              ["/dashboard/reviews", "Review queue"],
              ["/dashboard/wallet", "Wallet & scanner"],
              ["/dashboard/monitoring", "Monitoring"],
            ].map(([href, label]) => (
              <Button key={href} variant="outline" asChild>
                <Link href={href!}>{label}</Link>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
      <p className="mt-5 text-xs leading-6 text-muted-foreground">
        Diperbarui {dateTime(overview.as_of)} WIB. Data dapat berubah ketika
        pembayaran baru masuk. Angka review menghitung invoice dengan transfer
        yang masih perlu diperiksa; bisa termasuk invoice paid. Transfer tanpa
        invoice tersedia di Review queue.
      </p>
    </>
  );
}
