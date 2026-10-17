import {
  ArrowLeft,
  ReceiptText,
  ArrowDownLeft,
  GitBranch,
  Webhook,
} from "lucide-react";
import StatusBadge from "../../status-badge";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  adminGet,
  AdminApiError,
  dateTime,
  tokenLabel,
  explorerSignature,
  type InvoiceDetail,
} from "@/lib/admin";
export const dynamic = "force-dynamic";
export default async function Invoice({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    before_transfer?: string;
    before_event?: string;
    before_delivery?: string;
  }>;
}) {
  const { id } = await params;
  const search = await searchParams,
    query = new URLSearchParams();
  for (const key of [
    "before_transfer",
    "before_event",
    "before_delivery",
  ] as const)
    if (search[key]) query.set(key, search[key]!);
  let detail: InvoiceDetail;
  try {
    detail = await adminGet<InvoiceDetail>(
      `invoices/${encodeURIComponent(id)}?${query}`,
    );
  } catch (error) {
    if (!(error instanceof AdminApiError)) throw error;
    if (
      error instanceof AdminApiError &&
      (error.status === 404 || error.status === 400)
    )
      notFound();
    return (
      <div>
        <h1 className="text-2xl font-semibold">Detail belum tersedia.</h1>
        <p role="alert" className="my-4">
          Data transaksi belum dapat diambil. Coba muat ulang.
        </p>
        <Link href="/dashboard/invoices" className="text-primary underline">
          Kembali ke invoice
        </Link>
      </div>
    );
  }
  function HistoryPages({
    kind,
    cursorKey,
    anchor,
  }: {
    kind: "transfers" | "events" | "deliveries";
    cursorKey: "before_transfer" | "before_event" | "before_delivery";
    anchor: string;
  }) {
    const next = new URLSearchParams(query),
      first = new URLSearchParams(query),
      cursor = detail.next_cursors?.[kind];
    first.delete(cursorKey);
    if (cursor) next.set(cursorKey, cursor);
    return (
      <nav
        aria-label={`Halaman ${kind}`}
        className="mt-4 flex flex-wrap gap-4 text-xs text-primary"
      >
        {query.has(cursorKey) && (
          <Link
            className="inline-flex min-h-11 items-center underline"
            href={`/dashboard/invoices/${id}?${first}#${anchor}`}
          >
            Riwayat terbaru
          </Link>
        )}
        {cursor && (
          <Link
            className="inline-flex min-h-11 items-center underline"
            href={`/dashboard/invoices/${id}?${next}#${anchor}`}
          >
            Riwayat berikutnya
          </Link>
        )}
      </nav>
    );
  }
  const invoice = detail.invoice;
  return (
    <>
      <Button variant="outline" asChild>
        <Link href="/dashboard/invoices">
          <ArrowLeft size={15} aria-hidden="true" />
          Kembali ke invoice
        </Link>
      </Button>
      <div className="mt-4">
        <Button variant="outline" asChild>
          <Link href={`/dashboard/invoices/${id}/refunds`}>Riwayat refund</Link>
        </Button>
      </div>
      <div className="my-7 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="break-all text-2xl font-semibold tracking-tight">
            Detail invoice.
          </h1>
          <p className="mt-3 break-all text-sm text-muted-foreground">
            {invoice.order_id}
          </p>
        </div>
        <StatusBadge status={invoice.status} />
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-6">
          <Card className="shadow-none">
            <CardContent className="p-6">
              <h2 className="flex items-center gap-2 font-semibold">
                <ReceiptText
                  size={17}
                  className="text-primary"
                  aria-hidden="true"
                />
                Rincian pembayaran
              </h2>
              <p className="my-5 break-all text-2xl font-semibold">
                {invoice.payable_amount}{" "}
                {tokenLabel(invoice.asset, invoice.cluster)}
              </p>
              <dl className="space-y-4 text-sm">
                {[
                  ["Invoice ID", invoice.id],
                  ["Project", invoice.project_name],
                  ["Nominal dasar", invoice.amount],
                  ["Dibuat (WIB)", dateTime(invoice.created_at)],
                  ["Expired (WIB)", dateTime(invoice.expires_at)],
                  ["Versi", String(invoice.invoice_version)],
                  ["Wallet penerima", invoice.recipient],
                  ["Mint token", invoice.mint],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="mt-1 break-all">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <Card className="shadow-none">
            <CardContent className="p-6">
              <h2 className="font-semibold">Pilihan pembayaran</h2>
              {detail.attempts.map((attempt) => (
                <div
                  key={attempt.id}
                  className="mt-4 rounded-lg border p-4 text-sm"
                >
                  <p className="font-medium">
                    {tokenLabel(attempt.asset, invoice.cluster)} ·{" "}
                    {attempt.payable_amount}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {attempt.activated_at
                      ? `Diaktifkan ${dateTime(attempt.activated_at)} WIB`
                      : "Belum diaktifkan"}
                  </p>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs">
                      Mint dan akun penerima
                    </summary>
                    <p className="mt-2 break-all text-xs leading-6">
                      Mint: {attempt.mint}
                      <br />
                      Penerima: {attempt.recipient}
                    </p>
                  </details>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <Card id="transfers" className="scroll-mt-28 shadow-none">
            <CardContent className="p-6">
              <h2 className="flex items-center gap-2 font-semibold">
                <ArrowDownLeft
                  size={17}
                  className="text-primary"
                  aria-hidden="true"
                />
                Transfer on-chain
              </h2>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">
                Transaksi yang tercatat oleh scanner finalized. Link explorer
                mengikuti jaringan invoice.
              </p>
              {!detail.transfers.length && (
                <p className="py-6 text-sm text-muted-foreground">
                  Belum ada transfer tercatat.
                </p>
              )}
              {detail.transfers.map((transfer) => (
                <article
                  className="mt-4 rounded-lg border p-4"
                  key={`${transfer.signature}:${transfer.instruction_path}`}
                >
                  <div className="flex flex-wrap justify-between gap-3 text-sm">
                    <p className="font-mono">
                      {transfer.amount}{" "}
                      {tokenLabel(
                        transfer.asset ??
                          detail.attempts.find((a) => a.mint === transfer.mint)
                            ?.asset ??
                          "Token",
                        invoice.cluster,
                      )}
                    </p>
                    <Badge variant="outline">{transfer.disposition}</Badge>
                  </div>
                  <p className="my-3 text-xs leading-6 text-muted-foreground">
                    {dateTime(transfer.block_time)} WIB · Slot {transfer.slot} ·
                    Instruksi {transfer.instruction_path}
                  </p>
                  <a
                    href={explorerSignature(
                      transfer.signature,
                      invoice.cluster,
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block break-all text-xs leading-6 text-primary underline underline-offset-4"
                    aria-label="Lihat transaksi di Solana Explorer"
                  >
                    {transfer.signature}
                  </a>
                  {transfer.id && transfer.disposition !== "paid" && (
                    <Link
                      href={`/dashboard/reviews/${transfer.id}`}
                      className="mt-2 inline-flex min-h-11 items-center text-xs text-primary underline"
                    >
                      Tinjau transfer
                    </Link>
                  )}
                </article>
              ))}
              <HistoryPages
                kind="transfers"
                cursorKey="before_transfer"
                anchor="transfers"
              />
            </CardContent>
          </Card>
          <Card id="events" className="scroll-mt-28 shadow-none">
            <CardContent className="p-6">
              <h2 className="flex items-center gap-2 font-semibold">
                <GitBranch
                  size={17}
                  className="text-primary"
                  aria-hidden="true"
                />
                Timeline invoice &amp; event
              </h2>
              <ol className="mt-4 space-y-4 border-l pl-4 text-sm">
                <li>
                  <p>Invoice dibuat</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {dateTime(invoice.created_at)} WIB
                  </p>
                </li>
                {detail.events.toReversed().map((event) => (
                  <li key={event.event_id}>
                    <p className="break-all font-medium">{event.event_type}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {dateTime(event.created_at)} WIB
                    </p>
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                      {event.event_id}
                    </p>
                  </li>
                ))}
              </ol>
              <HistoryPages
                kind="events"
                cursorKey="before_event"
                anchor="events"
              />
            </CardContent>
          </Card>
          <Card id="deliveries" className="scroll-mt-28 shadow-none">
            <CardContent className="p-6">
              <h2 className="flex items-center gap-2 font-semibold">
                <Webhook
                  size={17}
                  className="text-primary"
                  aria-hidden="true"
                />
                Delivery webhook
              </h2>
              {!detail.deliveries.length ? (
                <p className="mt-4 text-sm leading-7 text-muted-foreground">
                  Belum ada delivery tercatat. Event yang sudah dibuat tidak
                  membuktikan webhook telah terkirim.
                </p>
              ) : (
                detail.deliveries.map((delivery) => (
                  <div
                    key={delivery.id}
                    className="mt-4 rounded-lg border p-4 text-sm"
                  >
                    <Badge variant="outline">{delivery.status}</Badge>
                    <p className="mt-3 text-xs leading-6">
                      Percobaan: {delivery.attempt_count} · HTTP terakhir:{" "}
                      {delivery.last_http_status ?? "—"}
                    </p>
                    <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                      {delivery.event_id}
                    </p>
                  </div>
                ))
              )}
              <HistoryPages
                kind="deliveries"
                cursorKey="before_delivery"
                anchor="deliveries"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
