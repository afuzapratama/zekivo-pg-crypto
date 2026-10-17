import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  adminGet,
  AdminApiError,
  dateTime,
  tokenLabel,
  explorerSignature,
  type AdminSession,
  type InvoiceDetail,
} from "@/lib/admin";
import RefundForm from "./form";
export const dynamic = "force-dynamic";
type Refunds = {
  items: {
    id: string;
    asset: string;
    amount: string;
    destination: string;
    destination_account: string;
    source_account: string;
    mint: string;
    signature: string;
    instruction_path: string;
    slot: string;
    reason: string;
    destination_verification: string;
    object_id: string;
    verified_at: string;
  }[];
  totals: { asset: string; amount: string }[];
  next_cursor: string | null;
};
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ before?: string }>;
}) {
  const { id } = await params,
    { before } = await searchParams;
  let detail: InvoiceDetail, refunds: Refunds, session: AdminSession;
  try {
    [detail, refunds, session] = await Promise.all([
      adminGet<InvoiceDetail>(`invoices/${encodeURIComponent(id)}`),
      adminGet<Refunds>(
        `invoices/${encodeURIComponent(id)}/refunds${before ? `?before=${encodeURIComponent(before)}` : ""}`,
      ),
      adminGet<AdminSession>("auth/session"),
    ]);
  } catch (error) {
    if (error instanceof AdminApiError && [400, 404].includes(error.status))
      notFound();
    if (!(error instanceof AdminApiError)) throw error;
    return (
      <div>
        <h1 className="text-2xl font-semibold">Refund belum tersedia.</h1>
        <p role="alert" className="my-4">
          Riwayat belum dapat diambil. Muat ulang untuk mencoba lagi.
        </p>
      </div>
    );
  }
  return (
    <>
      <Button variant="outline" asChild>
        <Link href={`/dashboard/invoices/${id}`}>
          Kembali ke detail invoice
        </Link>
      </Button>
      <h1 className="mt-7 text-3xl font-semibold">Refund manual.</h1>
      <p className="my-4 break-all text-sm text-muted-foreground">
        {detail.invoice.order_id} · {detail.invoice.cluster}
      </p>
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Card>
          <CardContent className="space-y-4 p-6">
            <h2 className="text-lg font-semibold">
              Catat refund yang sudah dikirim
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Kirim dana dari wallet treasury di luar aplikasi. Cocokkan alamat
              dengan pembeli sebelum mengirim. Formulir ini memeriksa satu
              instruksi transfer finalized dari akun token treasury ke akun
              token canonical milik tujuan.
            </p>
            <p className="text-sm leading-6 text-muted-foreground">
              Tahap ini untuk pengembalian kredit pembayaran invoice paid, dalam
              aset yang sama. Periksa riwayat sebelum mengirim; batas pencatatan
              di aplikasi tidak mencegah transfer berlebih dari wallet.
              Pembayaran bruto, status invoice, dan webhook pembayaran tetap
              tercatat seperti semula.
            </p>
            {detail.invoice.status !== "paid" ? (
              <p role="status" className="text-sm">
                Invoice belum paid. Pencatatan refund belum tersedia.
              </p>
            ) : session.permissions.includes("refund:write") ? (
              <RefundForm
                id={id}
                csrf={session.csrf_token}
                reauth={session.reauthentication_required ?? true}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Hanya admin yang dapat mencatat refund. Akun ini dapat membaca
                riwayat.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-4 p-6">
            <h2 className="text-lg font-semibold">
              Riwayat refund terverifikasi
            </h2>
            <p className="text-xs leading-6 text-muted-foreground">
              Konfirmasi alamat adalah catatan pemeriksaan admin, bukan bukti
              identitas pemilik wallet. Bukti chain diverifikasi saat
              pencatatan.
            </p>
            {refunds.totals.map((row) => (
              <p key={row.asset} className="text-sm font-medium">
                Total {tokenLabel(row.asset, detail.invoice.cluster)}:{" "}
                {row.amount}
              </p>
            ))}
            {refunds.items.map((row) => (
              <article
                key={row.id}
                className="space-y-3 rounded-lg border p-4 text-xs leading-6"
              >
                <h3 className="text-sm font-semibold">
                  {row.amount} {tokenLabel(row.asset, detail.invoice.cluster)} ·
                  Confirmed
                </h3>
                <p className="break-all">Tujuan: {row.destination}</p>
                <p className="break-all">
                  Akun token tujuan: {row.destination_account}
                </p>
                <p className="break-all">Sumber: {row.source_account}</p>
                <p className="break-all">Mint: {row.mint}</p>
                <p className="break-all">Alasan: {row.reason}</p>
                <p className="break-all">
                  Konfirmasi alamat: {row.destination_verification}
                </p>
                <p>
                  Slot {row.slot} · Instruksi {row.instruction_path}
                </p>
                <p className="break-all">Admin: {row.object_id}</p>
                <p>{dateTime(row.verified_at)} WIB</p>
                <a
                  href={explorerSignature(
                    row.signature,
                    detail.invoice.cluster,
                  )}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center break-all text-primary underline"
                >
                  Lihat transaksi refund
                </a>
              </article>
            ))}
            {!refunds.items.length && (
              <p role="status" className="text-sm text-muted-foreground">
                Belum ada refund tercatat.
              </p>
            )}
            <nav
              aria-label="Halaman refund"
              className="flex flex-wrap gap-4 text-sm"
            >
              {before && (
                <Link
                  className="inline-flex min-h-11 items-center text-primary underline"
                  href={`/dashboard/invoices/${id}/refunds`}
                >
                  Riwayat terbaru
                </Link>
              )}
              {refunds.next_cursor && (
                <Link
                  className="inline-flex min-h-11 items-center text-primary underline"
                  href={`/dashboard/invoices/${id}/refunds?before=${refunds.next_cursor}`}
                >
                  Halaman berikutnya
                </Link>
              )}
            </nav>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
