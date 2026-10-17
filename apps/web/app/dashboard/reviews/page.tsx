import Link from "next/link";
import { ClipboardList, ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { adminGet, dateTime, tokenLabel, type Project } from "@/lib/admin";
import { reviewLabels, reasonLabels, type ReviewTransfer } from "./types";
import RefreshButton from "../refresh-button";
export const dynamic = "force-dynamic";
export default async function Reviews({
  searchParams,
}: {
  searchParams: Promise<{
    before?: string;
    status?: string;
    disposition?: string;
    project_id?: string;
    asset?: string;
  }>;
}) {
  const query = await searchParams;
  const qs = new URLSearchParams();
  for (const key of [
    "before",
    "status",
    "disposition",
    "project_id",
    "asset",
  ] as const)
    if (query[key]) qs.set(key, query[key]!);
  const [data, projects] = await Promise.all([
    adminGet<{ items: ReviewTransfer[]; next_cursor: string | null }>(
      `reviews?${qs}`,
    ),
    adminGet<{ items: Project[] }>("projects"),
  ]);
  const cluster = process.env.SOLANA_CLUSTER ?? "localnet";
  function pageHref(cursor?: string) {
    const next = new URLSearchParams(qs);
    next.delete("before");
    if (cursor) next.set("before", cursor);
    return `/dashboard/reviews?${next}`;
  }
  const select =
    "mt-2 min-h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm";
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight">
            <ClipboardList aria-hidden="true" />
            Review queue
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
            Telusuri transfer yang memerlukan penanganan dan catat keputusan
            operator. Status review terpisah dari status pembayaran invoice.
          </p>
        </div>
        <RefreshButton />
      </div>
      <form
        className="grid gap-4 rounded-xl border bg-white p-5 sm:grid-cols-2 xl:grid-cols-5"
        action="/dashboard/reviews"
      >
        <label className="min-w-0 text-xs font-medium">
          Status review
          <select
            name="status"
            defaultValue={query.status ?? "active"}
            className={select}
          >
            <option value="active">Review aktif</option>
            <option value="all">Semua status</option>
            {Object.entries(reviewLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-xs font-medium">
          Jenis masalah
          <select
            name="disposition"
            defaultValue={query.disposition ?? ""}
            className={select}
          >
            <option value="">Semua masalah</option>
            {Object.entries(reasonLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-xs font-medium">
          Project
          <select
            name="project_id"
            defaultValue={query.project_id ?? ""}
            className={select}
          >
            <option value="">Semua, termasuk tanpa invoice</option>
            {projects.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-xs font-medium">
          Token
          <select
            name="asset"
            defaultValue={query.asset ?? ""}
            className={select}
          >
            <option value="">Semua token</option>
            <option value="USDC">USDC</option>
            <option value="USDT">{tokenLabel("USDT", cluster)}</option>
          </select>
        </label>
        <button className="min-h-11 self-end rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
          Terapkan filter
        </button>
      </form>
      <Card className="shadow-none">
        <CardContent className="p-5 sm:p-6">
          <h2 className="mb-5 font-semibold">Transfer untuk ditinjau</h2>
          {!data.items.length && (
            <p
              role="status"
              className="py-10 text-center text-sm text-muted-foreground"
            >
              Tidak ada transfer pada filter ini.
            </p>
          )}
          <div className="space-y-4">
            {data.items.map((t) => (
              <article key={t.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-semibold">
                    {reasonLabels[t.disposition] ?? t.disposition}
                  </h3>
                  <Badge variant="outline">
                    {reviewLabels[t.review_status] ?? t.review_status}
                  </Badge>
                </div>
                <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                  <p>
                    {t.amount}{" "}
                    {t.asset
                      ? tokenLabel(t.asset, cluster)
                      : "Token tidak tersedia"}
                  </p>
                  <p className="break-words text-muted-foreground">
                    {t.project_name ?? "Tanpa invoice/project"}
                    {t.order_id ? ` · ${t.order_id}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {dateTime(t.block_time)} WIB
                  </p>
                </div>
                <p className="mt-3 break-all font-mono text-[11px] text-muted-foreground">
                  {t.signature}
                </p>
                <Link
                  href={`/dashboard/reviews/${t.id}`}
                  className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary"
                >
                  Tinjau transfer #{t.id}
                  <ArrowUpRight size={14} aria-hidden="true" />
                </Link>
              </article>
            ))}
          </div>
          <nav
            aria-label="Halaman review"
            className="mt-5 flex flex-wrap gap-5 text-sm text-primary"
          >
            {query.before && (
              <Link
                className="inline-flex min-h-11 items-center underline"
                href={pageHref()}
              >
                Review terbaru
              </Link>
            )}
            {data.next_cursor && (
              <Link
                className="inline-flex min-h-11 items-center underline"
                href={pageHref(data.next_cursor)}
              >
                Review berikutnya
              </Link>
            )}
          </nav>
        </CardContent>
      </Card>
    </div>
  );
}
