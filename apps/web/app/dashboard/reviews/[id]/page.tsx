import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  adminGet,
  AdminApiError,
  dateTime,
  tokenLabel,
  explorerSignature,
  type AdminSession,
} from "@/lib/admin";
import { reviewLabels, reasonLabels, type ReviewDetail } from "../types";
import ReviewForm from "./form";
export const dynamic = "force-dynamic";
export default async function ReviewDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ before_note?: string }>;
}) {
  const { id } = await params,
    { before_note } = await searchParams;
  let data: ReviewDetail, session: AdminSession;
  try {
    [data, session] = await Promise.all([
      adminGet<ReviewDetail>(
        `reviews/${encodeURIComponent(id)}${before_note ? `?before_note=${encodeURIComponent(before_note)}` : ""}`,
      ),
      adminGet<AdminSession>("auth/session"),
    ]);
  } catch (error) {
    if (error instanceof AdminApiError && [400, 404].includes(error.status))
      notFound();
    throw error;
  }
  const t = data.transfer,
    cluster = process.env.SOLANA_CLUSTER ?? "localnet";
  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/reviews"
        className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        Review queue
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Review transfer #{id}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {reasonLabels[t.disposition] ?? t.disposition}
          </p>
        </div>
        <Badge variant="outline" aria-label="Status review saat ini">
          {reviewLabels[t.review_status]}
        </Badge>
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card className="shadow-none">
          <CardContent className="space-y-5 p-6">
            <h2 className="font-semibold">Bukti transfer</h2>
            <p className="text-2xl font-semibold">
              {t.amount}{" "}
              <span className="text-sm text-muted-foreground">
                {t.asset
                  ? tokenLabel(t.asset, cluster)
                  : "Token tidak tersedia"}
              </span>
            </p>
            <dl className="space-y-4 text-xs">
              {[
                [
                  "Project / order",
                  `${t.project_name ?? "Tanpa invoice/project"}${t.order_id ? ` · ${t.order_id}` : ""}`,
                ],
                ["Waktu transfer", `${dateTime(t.block_time)} WIB`],
                ["Slot finalized", t.slot],
                ["Instruction", t.instruction_path],
                ["Mint", t.mint],
                ["Akun token penerima", t.destination],
                ["Signature", t.signature],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="mb-1 text-muted-foreground">{label}</dt>
                  <dd className="break-all leading-6">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap gap-5">
              <a
                className="inline-flex min-h-11 items-center gap-2 text-xs text-primary underline"
                href={explorerSignature(t.signature, cluster)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Lihat di Solana Explorer
                <ExternalLink size={13} aria-hidden="true" />
              </a>
              {t.invoice_id && (
                <Link
                  className="inline-flex min-h-11 items-center text-xs text-primary underline"
                  href={`/dashboard/invoices/${t.invoice_id}`}
                >
                  Invoice terkait
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardContent className="space-y-4 p-6">
            <h2 className="font-semibold">Catat penanganan</h2>
            <p className="text-xs leading-6 text-muted-foreground">
              Periksa bukti transfer dan catat alasan keputusan. Penanganan di
              sini tidak mengeksekusi refund atau mengesahkan pembayaran.
            </p>
            {session.permissions.includes("review:write") ? (
              <ReviewForm
                key={`${id}:${t.review_version}`}
                id={id}
                csrf={session.csrf_token}
                status={t.review_status}
                version={t.review_version}
                reauth={session.reauthentication_required ?? true}
              />
            ) : (
              <p className="text-sm leading-7 text-muted-foreground">
                Hanya admin atau operator dapat mencatat penanganan. Aksesmu
                saat ini read-only.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
      <Card className="shadow-none">
        <CardContent className="space-y-4 p-6">
          <h2 className="font-semibold">Riwayat penanganan</h2>
          {!data.notes.length && (
            <p className="py-5 text-sm text-muted-foreground">
              Belum ada catatan operator.
            </p>
          )}
          {data.notes.map((n) => (
            <article key={n.id} className="space-y-2 rounded-xl border p-4">
              <p className="text-sm font-medium">
                {reviewLabels[n.from_status]} → {reviewLabels[n.to_status]}
              </p>
              <p className="whitespace-pre-wrap break-words text-sm leading-7">
                {n.reason}
              </p>
              <p className="break-all text-[11px] leading-6 text-muted-foreground">
                {dateTime(n.created_at)} WIB · Operator {n.object_id} · Versi{" "}
                {n.version}
              </p>
            </article>
          ))}
          <nav
            aria-label="Halaman catatan review"
            className="flex flex-wrap gap-5 text-sm text-primary"
          >
            {before_note && (
              <Link
                className="inline-flex min-h-11 items-center underline"
                href={`/dashboard/reviews/${id}`}
              >
                Catatan terbaru
              </Link>
            )}
            {data.next_note_cursor && (
              <Link
                className="inline-flex min-h-11 items-center underline"
                href={`/dashboard/reviews/${id}?before_note=${data.next_note_cursor}`}
              >
                Catatan berikutnya
              </Link>
            )}
          </nav>
        </CardContent>
      </Card>
    </div>
  );
}
