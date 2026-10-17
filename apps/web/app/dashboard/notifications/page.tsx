import Link from "next/link";
import { Bell, Mail, Send } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { adminGet, dateTime, type AdminSession } from "@/lib/admin";
import RefreshButton from "../refresh-button";
import ChannelForm, { type Channel } from "./form";
export const dynamic = "force-dynamic";
const labels: Record<string, string> = {
  waiting_configuration: "Menunggu konfigurasi",
  pending: "Menunggu pengiriman",
  inflight: "Sedang dikirim",
  sent: "Diterima provider",
  dead: "Gagal setelah retry",
  expired: "Kedaluwarsa",
};
type Data = {
  key_configured: boolean;
  mailpit_allowed: boolean;
  channels: Channel[];
  items: {
    id: string;
    channel: string;
    status: string;
    attempt_count: number;
    last_error: string | null;
    sent_at: string | null;
    created_at: string;
    expires_at: string;
    title: string;
    event_type: string;
  }[];
  next_cursor: string | null;
  worker: {
    scanner_status: string;
    last_success_at: string | null;
    last_error_at: string | null;
    updated_at: string;
  } | null;
};
export default async function Notifications({
  searchParams,
}: {
  searchParams: Promise<{ before?: string }>;
}) {
  const { before } = await searchParams;
  const [data, session] = await Promise.all([
    adminGet<Data>(
      `notifications${before ? `?before=${encodeURIComponent(before)}` : ""}`,
    ),
    adminGet<AdminSession>("auth/session"),
  ]);
  const manage = session.permissions.includes("notification:manage");
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight">
            <Bell aria-hidden="true" />
            Notifikasi admin
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
            Email SMTP dan Telegram untuk pembayaran confirmed, review
            transaksi, webhook gagal permanen dan gangguan scanner.
          </p>
        </div>
        <RefreshButton />
      </div>
      <div
        role="status"
        className="rounded-xl border bg-muted/40 p-4 text-sm leading-7"
      >
        Tanpa kanal aktif, notifikasi menunggu konfigurasi. Pesan yang belum
        terkirim kedaluwarsa setelah 24 jam. Pengiriman memakai retry; provider
        menerima pesan belum memastikan email sudah masuk inbox.
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-2">
        {(["email", "telegram"] as const).map((channel) => {
          const value = data.channels.find((c) => c.channel === channel),
            Icon = channel === "email" ? Mail : Send;
          return (
            <Card key={channel} className="shadow-none">
              <CardContent className="space-y-5 p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="flex items-center gap-2 font-semibold">
                    <Icon size={18} aria-hidden="true" />
                    {channel === "email" ? "Email SMTP" : "Telegram admin"}
                  </h2>
                  <Badge variant="outline">
                    {value?.enabled
                      ? "Aktif"
                      : value
                        ? "Nonaktif"
                        : "Belum dikonfigurasi"}
                  </Badge>
                </div>
                {manage ? (
                  <ChannelForm
                    key={channel}
                    channel={channel}
                    value={value}
                    csrf={session.csrf_token}
                    reauth={session.reauthentication_required ?? true}
                    keyReady={data.key_configured}
                    allowMailpit={data.mailpit_allowed}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Pengaturan kanal hanya dapat diubah admin.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Card className="shadow-none">
        <CardContent className="space-y-3 p-6">
          <h2 className="font-semibold">Status scanner terakhir</h2>
          {data.worker ? (
            <>
              <p className="text-sm">
                {data.worker.scanner_status} · diperbarui{" "}
                {dateTime(data.worker.updated_at)} WIB
              </p>
              <p className="text-xs text-muted-foreground">
                Pemindaian sukses terakhir:{" "}
                {data.worker.last_success_at
                  ? `${dateTime(data.worker.last_success_at)} WIB`
                  : "Belum tercatat"}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Worker belum melaporkan status.
            </p>
          )}
          <p className="text-xs leading-6 text-muted-foreground">
            Jika seluruh worker mati, alert dari worker juga berhenti.
            Pemantauan uptime eksternal tetap diperlukan.
          </p>
        </CardContent>
      </Card>
      <Card className="shadow-none">
        <CardContent className="space-y-4 p-6">
          <h2 className="font-semibold">Log pengiriman notifikasi</h2>
          {!data.items.length && (
            <p className="py-8 text-sm text-muted-foreground">
              Belum ada notifikasi pada halaman ini.
            </p>
          )}
          {data.items.map((item) => (
            <article key={item.id} className="space-y-3 rounded-xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h3 className="text-sm font-medium">{item.title}</h3>
                <Badge variant="outline">
                  {labels[item.status] ?? item.status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                #{item.id} · {item.channel} · {item.event_type} · Percobaan{" "}
                {item.attempt_count}
              </p>
              <p className="text-xs leading-6 text-muted-foreground">
                {dateTime(item.created_at)} WIB
                {item.sent_at
                  ? ` · Diterima provider ${dateTime(item.sent_at)} WIB`
                  : ""}
                {item.last_error ? ` · ${item.last_error}` : ""}
              </p>
            </article>
          ))}
          <nav
            aria-label="Halaman log notifikasi"
            className="flex flex-wrap gap-5 text-sm text-primary"
          >
            {before && (
              <Link
                className="inline-flex min-h-11 items-center underline"
                href="/dashboard/notifications"
              >
                Notifikasi terbaru
              </Link>
            )}
            {data.next_cursor && (
              <Link
                className="inline-flex min-h-11 items-center underline"
                href={`/dashboard/notifications?before=${data.next_cursor}`}
              >
                Notifikasi berikutnya
              </Link>
            )}
          </nav>
        </CardContent>
      </Card>
    </div>
  );
}
