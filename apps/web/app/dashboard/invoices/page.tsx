import RefreshButton from "../refresh-button";
import { ReceiptText, SlidersHorizontal } from "lucide-react";
import StatusBadge from "../status-badge";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  adminGet,
  AdminApiError,
  dateTime,
  tokenLabel,
  type InvoicePage,
  type Project,
} from "@/lib/admin";
export const dynamic = "force-dynamic";
export default async function Invoices({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  const query = new URLSearchParams();
  for (const name of ["status", "asset", "order_id", "project_id", "before"]) {
    const value = search[name];
    if (typeof value === "string" && value) query.set(name, value);
  }
  let invoices: InvoicePage, projects: { items: Project[] };
  try {
    [invoices, projects] = await Promise.all([
      adminGet<InvoicePage>(`invoices?${query}`),
      adminGet<{ items: Project[] }>("projects"),
    ]);
  } catch (error) {
    if (!(error instanceof AdminApiError)) throw error;
    return (
      <div className="rounded-xl border bg-white p-7">
        <h1 className="text-2xl font-semibold">
          Invoice belum dapat ditampilkan.
        </h1>
        <p role="alert" className="my-4 text-muted-foreground">
          {error.status === 400
            ? "Filter atau halaman sudah tidak valid."
            : "Data invoice belum dapat diambil."}
        </p>
        <Button asChild>
          <Link href="/dashboard/invoices">Muat invoice</Link>
        </Button>
      </div>
    );
  }
  const next = new URLSearchParams(query);
  if (invoices.next_cursor) next.set("before", invoices.next_cursor);
  const first = new URLSearchParams(query);
  first.delete("before");
  const selectClass = "min-h-11 w-full rounded-md border bg-white px-3 text-sm";
  return (
    <>
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Invoice.</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Kelola pencarian dan riwayat invoice · Waktu WIB
          </p>
        </div>
        <RefreshButton />
      </div>
      <Card id="invoices" className="scroll-mt-28 overflow-hidden shadow-none">
        <CardContent className="p-5 sm:p-7">
          <div className="flex items-center gap-2">
            <ReceiptText
              size={19}
              className="text-primary"
              aria-hidden="true"
            />
            <h2 className="text-lg font-semibold">Daftar invoice</h2>
          </div>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            Cari invoice berdasarkan project, status, aset, dan Order ID.
          </p>
          <form
            method="get"
            action="/dashboard/invoices"
            className="my-5 grid items-end gap-4 rounded-xl border bg-muted/20 p-4 sm:grid-cols-2 xl:grid-cols-5"
          >
            <label className="space-y-2 text-xs font-medium">
              Project
              <select
                aria-label="Project"
                name="project_id"
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
            <label className="space-y-2 text-xs font-medium">
              Status
              <select
                aria-label="Status"
                name="status"
                defaultValue={query.get("status") ?? ""}
                className={selectClass}
              >
                <option value="">Semua status</option>
                {["pending", "confirming", "paid", "expired"].map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-xs font-medium">
              Aset
              <select
                aria-label="Aset"
                name="asset"
                defaultValue={query.get("asset") ?? ""}
                className={selectClass}
              >
                <option value="">Semua aset</option>
                <option value="USDT">
                  {tokenLabel("USDT", process.env.SOLANA_CLUSTER ?? "devnet")}
                </option>
                <option value="USDC">USDC</option>
              </select>
            </label>
            <label className="space-y-2 text-xs font-medium">
              Order ID
              <Input
                aria-label="Order ID"
                name="order_id"
                defaultValue={query.get("order_id") ?? ""}
                placeholder="Order ID persis"
                maxLength={128}
                className="min-h-11"
              />
            </label>
            <Button type="submit" className="min-h-11">
              <SlidersHorizontal size={14} aria-hidden="true" />
              Terapkan filter
            </Button>
          </form>
          <div className="hidden overflow-x-auto xl:block">
            <table className="w-full text-left text-sm">
              <thead className="border-y bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  {[
                    "Order / invoice",
                    "Aset",
                    "Nominal persis",
                    "Status",
                    "Dibuat (WIB)",
                    "Detail",
                  ].map((label) => (
                    <th key={label} className="px-3 py-4 font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.items.map((invoice) => (
                  <tr
                    key={invoice.id}
                    className="border-b transition-colors hover:bg-muted/20"
                  >
                    <td className="max-w-64 break-all px-3 py-4">
                      <p>{invoice.order_id}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {invoice.project_name}
                      </p>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">
                        {invoice.id}
                      </p>
                    </td>
                    <td className="px-3 py-4">
                      {tokenLabel(invoice.asset, invoice.cluster)}
                    </td>
                    <td className="px-3 py-4 font-mono">
                      {invoice.payable_amount}
                    </td>
                    <td className="px-3 py-4">
                      <StatusBadge status={invoice.status} />
                    </td>
                    <td className="px-3 py-4 text-xs">
                      {dateTime(invoice.created_at)}
                    </td>
                    <td className="px-3 py-4">
                      <Link
                        className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
                        href={`/dashboard/invoices/${invoice.id}`}
                        aria-label={`Detail invoice ${invoice.order_id}`}
                      >
                        Lihat
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:hidden">
            {invoices.items.map((invoice) => (
              <article key={invoice.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <StatusBadge status={invoice.status} />
                  <span className="text-xs">
                    {tokenLabel(invoice.asset, invoice.cluster)}
                  </span>
                </div>
                <h3 className="mt-4 break-all text-sm font-medium">
                  {invoice.order_id}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {invoice.project_name}
                </p>
                <p className="mt-2 font-mono">{invoice.payable_amount}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {dateTime(invoice.created_at)} WIB
                </p>
                <Link
                  className="mt-2 inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4"
                  href={`/dashboard/invoices/${invoice.id}`}
                >
                  Lihat detail invoice
                </Link>
              </article>
            ))}
          </div>
          {!invoices.items.length && (
            <p
              role="status"
              className="py-12 text-center text-sm text-muted-foreground"
            >
              Tidak ada invoice sesuai filter.
            </p>
          )}
          <nav
            aria-label="Halaman invoice"
            className="mt-5 flex flex-wrap justify-between gap-3"
          >
            {query.has("before") ? (
              <Button variant="outline" asChild>
                <Link href={`/dashboard/invoices?${first}`}>
                  Kembali ke awal
                </Link>
              </Button>
            ) : (
              <span className="self-center text-xs text-muted-foreground">
                Maksimal 25 invoice per halaman
              </span>
            )}
            {invoices.next_cursor && (
              <Button variant="outline" asChild>
                <Link href={`/dashboard/invoices?${next}`}>
                  Halaman berikutnya
                </Link>
              </Button>
            )}
          </nav>
        </CardContent>
      </Card>
    </>
  );
}
