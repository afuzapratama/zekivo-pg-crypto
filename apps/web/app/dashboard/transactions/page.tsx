import Link from "next/link";
import { ArrowDownUp, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  adminGet,
  AdminApiError,
  dateTime,
  tokenLabel,
  explorerSignature,
  type Project,
} from "@/lib/admin";
import { reasonLabels, reviewLabels } from "../reviews/types";
import RefreshButton from "../refresh-button";
export const dynamic = "force-dynamic";
type Transfer = {
  id: string;
  cluster: string;
  signature: string;
  instruction_path: string;
  slot: string;
  block_time: string;
  created_at: string;
  mint: string;
  destination: string;
  amount: string;
  disposition: string;
  asset: string | null;
  invoice_id: string | null;
  order_id: string | null;
  invoice_status: string | null;
  project_name: string | null;
  review_status: string | null;
};
const labels = { paid: "Pembayaran diterima", ...reasonLabels };
function Evidence({ t }: { t: Transfer }) {
  return (
    <details className="mt-2 text-xs">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-muted-foreground">
        Rincian transfer
      </summary>
      <dl className="space-y-3 py-3">
        {[
          ["Slot finalized", t.slot],
          ["Instruction", t.instruction_path],
          ["Mint", t.mint],
          ["Akun token tujuan", t.destination],
          ["Tercatat scanner", `${dateTime(t.created_at)} WIB`],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="mt-1 break-all leading-6">{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
function Links({ t }: { t: Transfer }) {
  return (
    <div className="flex flex-wrap gap-x-4 text-xs">
      <a
        className="inline-flex min-h-11 items-center gap-1 text-primary underline"
        href={explorerSignature(t.signature, t.cluster)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Explorer transfer #${t.id}`}
      >
        Explorer
        <ExternalLink size={12} aria-hidden="true" />
      </a>
      {t.invoice_id && (
        <Link
          className="inline-flex min-h-11 items-center text-primary underline"
          href={`/dashboard/invoices/${t.invoice_id}`}
        >
          Invoice
        </Link>
      )}
      {t.disposition !== "paid" && (
        <Link
          className="inline-flex min-h-11 items-center text-primary underline"
          href={`/dashboard/reviews/${t.id}`}
        >
          Review
        </Link>
      )}
    </div>
  );
}
export default async function Transactions({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams,
    qs = new URLSearchParams();
  for (const key of [
    "before",
    "asset",
    "disposition",
    "project_id",
    "signature",
    "unassigned",
  ]) {
    const value = query[key];
    if (typeof value === "string" && value) qs.set(key, value);
  }
  let data: { items: Transfer[]; next_cursor: string | null },
    projects: { items: Project[] };
  try {
    [data, projects] = await Promise.all([
      adminGet<typeof data>(`transactions?${qs}`),
      adminGet<typeof projects>("projects"),
    ]);
  } catch (error) {
    if (!(error instanceof AdminApiError)) throw error;
    return (
      <div className="space-y-4 rounded-xl border bg-white p-6">
        <h1 className="text-2xl font-semibold">
          Transactions belum dapat ditampilkan.
        </h1>
        <p role="alert" className="text-sm leading-7 text-muted-foreground">
          {error.status === 400
            ? "Filter tidak valid. Gunakan signature Solana lengkap; pilih project atau tanpa invoice secara terpisah."
            : "Data transfer belum dapat diambil. Coba muat ulang."}
        </p>
        <Button asChild>
          <Link href="/dashboard/transactions">Buka daftar awal</Link>
        </Button>
      </div>
    );
  }
  const cluster = process.env.SOLANA_CLUSTER ?? "localnet",
    select =
      "mt-2 min-h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm";
  const first = new URLSearchParams(qs);
  first.delete("before");
  const next = new URLSearchParams(qs);
  if (data.next_cursor) next.set("before", data.next_cursor);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight">
            <ArrowDownUp aria-hidden="true" />
            Transactions
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
            Seluruh transfer yang dicatat scanner finalized, diurutkan dari yang
            paling baru tercatat. Satu transaksi blockchain dapat memiliki
            beberapa instruction transfer.
          </p>
        </div>
        <RefreshButton />
      </div>
      <form
        action="/dashboard/transactions"
        className="grid items-end gap-4 rounded-xl border bg-white p-5 sm:grid-cols-2 xl:grid-cols-4"
      >
        <label className="min-w-0 text-xs font-medium">
          Project
          <select
            aria-label="Project transaksi"
            name="project_id"
            defaultValue={qs.get("project_id") ?? ""}
            className={select}
          >
            <option value="">Semua project</option>
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
            aria-label="Token transaksi"
            name="asset"
            defaultValue={qs.get("asset") ?? ""}
            className={select}
          >
            <option value="">Semua token</option>
            <option value="USDT">{tokenLabel("USDT", cluster)}</option>
            <option value="USDC">USDC</option>
          </select>
        </label>
        <label className="min-w-0 text-xs font-medium">
          Klasifikasi transfer
          <select
            aria-label="Klasifikasi transfer"
            name="disposition"
            defaultValue={qs.get("disposition") ?? ""}
            className={select}
          >
            <option value="">Semua klasifikasi</option>
            {Object.entries(labels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            name="unassigned"
            type="checkbox"
            value="true"
            defaultChecked={qs.get("unassigned") === "true"}
          />
          Tanpa invoice
        </label>
        <div className="sm:col-span-2 xl:col-span-3">
          <label
            htmlFor="transaction-signature"
            className="mb-2 block text-xs font-medium"
          >
            Signature lengkap
          </label>
          <Input
            id="transaction-signature"
            name="signature"
            defaultValue={qs.get("signature") ?? ""}
            placeholder="Cari signature Solana secara persis"
            maxLength={88}
            className="min-h-11"
          />
        </div>
        <Button type="submit" className="min-h-11">
          Terapkan filter
        </Button>
      </form>
      <Card className="overflow-hidden shadow-none">
        <CardContent className="p-5 sm:p-6">
          <h2 className="mb-5 font-semibold">Daftar transfer</h2>
          <div className="hidden overflow-x-auto xl:block">
            <table className="w-full text-left text-sm">
              <thead className="border-y bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  {[
                    "Transfer / signature",
                    "Nominal",
                    "Project / invoice",
                    "Klasifikasi",
                    "Waktu (WIB)",
                    "Tautan",
                  ].map((label) => (
                    <th key={label} className="px-3 py-4 font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((t) => (
                  <tr key={t.id} className="border-b align-top">
                    <td className="max-w-72 px-3 py-4">
                      <p className="text-xs font-medium">#{t.id}</p>
                      <p className="mt-2 break-all font-mono text-[11px] leading-6">
                        {t.signature}
                      </p>
                      <Evidence t={t} />
                    </td>
                    <td className="px-3 py-4 font-mono text-xs">
                      <p>{t.amount}</p>
                      <p className="mt-2 text-muted-foreground">
                        {t.asset
                          ? tokenLabel(t.asset, t.cluster)
                          : "Token tidak tersedia"}
                      </p>
                    </td>
                    <td className="max-w-44 break-words px-3 py-4 text-xs leading-6">
                      {t.project_name ?? "Tanpa project"}
                      <p className="text-muted-foreground">
                        {t.order_id ?? "Tanpa invoice"}
                      </p>
                    </td>
                    <td className="px-3 py-4">
                      <Badge variant="outline">
                        {labels[t.disposition as keyof typeof labels] ??
                          t.disposition}
                      </Badge>
                      {t.review_status && (
                        <p className="mt-3 text-xs text-muted-foreground">
                          {reviewLabels[t.review_status]}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-4 text-xs leading-6">
                      {dateTime(t.block_time)}
                    </td>
                    <td className="px-3 py-3">
                      <Links t={t} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:hidden">
            {data.items.map((t) => (
              <article
                key={t.id}
                className="min-w-0 space-y-3 rounded-xl border p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h3 className="text-sm font-semibold">Transfer #{t.id}</h3>
                  <Badge variant="outline">
                    {labels[t.disposition as keyof typeof labels] ??
                      t.disposition}
                  </Badge>
                </div>
                <p className="font-mono text-sm">
                  {t.amount}{" "}
                  {t.asset
                    ? tokenLabel(t.asset, t.cluster)
                    : "Token tidak tersedia"}
                </p>
                <p className="break-words text-xs leading-6 text-muted-foreground">
                  {t.project_name ?? "Tanpa project"} ·{" "}
                  {t.order_id ?? "Tanpa invoice"}
                  {t.review_status ? ` · ${reviewLabels[t.review_status]}` : ""}
                </p>
                <p className="break-all font-mono text-[11px] leading-6">
                  {t.signature}
                </p>
                <p className="text-xs text-muted-foreground">
                  {dateTime(t.block_time)} WIB
                </p>
                <Evidence t={t} />
                <Links t={t} />
              </article>
            ))}
          </div>
          {!data.items.length && (
            <p
              role="status"
              className="py-10 text-center text-sm text-muted-foreground"
            >
              Tidak ada transfer sesuai filter.
            </p>
          )}
          <nav
            aria-label="Halaman transaksi"
            className="mt-5 flex flex-wrap justify-between gap-4 text-sm text-primary"
          >
            {qs.has("before") ? (
              <Link
                className="inline-flex min-h-11 items-center underline"
                href={`/dashboard/transactions?${first}`}
              >
                Transfer terbaru
              </Link>
            ) : (
              <span className="self-center text-xs text-muted-foreground">
                Maksimal 25 transfer per halaman
              </span>
            )}
            {data.next_cursor && (
              <Link
                className="inline-flex min-h-11 items-center underline"
                href={`/dashboard/transactions?${next}`}
              >
                Transfer berikutnya
              </Link>
            )}
          </nav>
        </CardContent>
      </Card>
      <p className="text-xs leading-6 text-muted-foreground">
        Klasifikasi berlaku untuk transfer, bukan status invoice. Transfer ganda
        dapat terkait invoice yang sudah paid. Token atau jaringan yang tidak
        dipantau tidak otomatis muncul di daftar ini.
      </p>
    </div>
  );
}
