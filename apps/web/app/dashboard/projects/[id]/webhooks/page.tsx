import ProjectTabs from "../tabs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Webhook, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  adminGet,
  AdminApiError,
  dateTime,
  type AdminSession,
} from "@/lib/admin";
import { WebhookAction } from "./actions";
export const dynamic = "force-dynamic";
type Data = {
  configured: boolean;
  delivery_enabled: boolean;
  has_more_endpoints: boolean;
  next_cursor: string | null;
  endpoints: {
    id: string;
    url: string;
    kind: string;
    active: boolean;
    created_at: string;
  }[];
  deliveries: {
    id: string;
    event_id: string;
    invoice_id: string;
    url: string;
    event_type: string;
    status: string;
    attempt_count: number;
    replay_count: number;
    last_http_status: number | null;
    last_error: string | null;
    next_attempt_at: string;
    delivered_at: string | null;
  }[];
};
type Attempt = {
  attempt_no: number;
  started_at: string;
  finished_at: string | null;
  http_status: number | null;
  error_code: string | null;
};
export default async function ProjectWebhooks({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ before?: string; delivery?: string }>;
}) {
  const { id } = await params;
  const { before, delivery } = await searchParams;
  let data: Data,
    session: AdminSession,
    project: { project: { name: string } },
    attempts: { items: Attempt[] } | undefined;
  try {
    [data, session, project] = await Promise.all([
      adminGet<Data>(
        `projects/${encodeURIComponent(id)}/webhooks${before ? `?before=${encodeURIComponent(before)}` : ""}`,
      ),
      adminGet<AdminSession>("auth/session"),
      adminGet<{ project: { name: string } }>(
        `projects/${encodeURIComponent(id)}`,
      ),
    ]);
    if (delivery)
      attempts = await adminGet(
        `projects/${encodeURIComponent(id)}/webhook-deliveries/${encodeURIComponent(delivery)}/attempts`,
      );
  } catch (error) {
    if (error instanceof AdminApiError && [400, 404].includes(error.status))
      notFound();
    throw error;
  }
  const manage = session.permissions.includes("project:manage"),
    replay = session.permissions.includes("webhook:replay");
  const actionProps = {
    projectId: id,
    csrf: session.csrf_token,
    reauth: session.reauthentication_required ?? true,
  };
  const href = `/dashboard/projects/${id}/webhooks`;
  return (
    <div className="space-y-6">
      <Link
        href={`/dashboard/projects/${id}`}
        className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        Kembali ke project
      </Link>
      <div>
        <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight">
          <Webhook aria-hidden="true" />
          Webhooks
        </h1>
        <p className="mt-3 break-words text-sm text-muted-foreground">
          {project.project.name} · Endpoint dan riwayat pengiriman event.
        </p>
      </div>
      <ProjectTabs id={id} section="webhooks" />
      <div
        role="status"
        className="rounded-xl border bg-muted/40 p-4 text-sm leading-7"
      >
        Pengiriman worker:{" "}
        <strong>{data.delivery_enabled ? "Aktif" : "Nonaktif"}</strong>.{" "}
        {data.delivery_enabled
          ? "Status delivered memerlukan respons HTTP 2xx dari penerima."
          : "Endpoint dapat disiapkan; delivery dan replay belum dikirim ke penerima."}{" "}
        Event otomatis saat ini: <code>payment.confirmed</code>.
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card className="shadow-none">
          <CardContent className="space-y-4 p-6">
            <h2 className="font-semibold">Endpoint project</h2>
            {!data.endpoints.length && (
              <p className="py-6 text-sm text-muted-foreground">
                Belum ada endpoint. Tambahkan URL backend website penerima.
              </p>
            )}
            {data.endpoints.map((e) => (
              <article key={e.id} className="space-y-3 rounded-xl border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {e.active ? "Aktif" : "Nonaktif"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {e.kind === "local_inbox" ? "Fixture local" : "HTTPS"}
                  </span>
                </div>
                <p className="break-all font-mono text-xs leading-6">{e.url}</p>
                <p className="text-xs text-muted-foreground">
                  Dibuat {dateTime(e.created_at)} WIB
                </p>
                {manage && data.configured && e.kind !== "local_inbox" && (
                  <WebhookAction {...actionProps} kind="rotate" id={e.id} />
                )}
              </article>
            ))}
            {data.has_more_endpoints && (
              <p className="text-xs text-muted-foreground">
                Menampilkan 100 endpoint terbaru. Endpoint lain tersedia melalui
                API merchant.
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardContent className="space-y-4 p-6">
            <h2 className="font-semibold">Tambah endpoint</h2>
            <p className="text-xs leading-6 text-muted-foreground">
              Gunakan HTTPS port 443 dengan DNS publik. Endpoint menerima event
              baru setelah pendaftaran; event historis tidak otomatis dikirim.
              Secret disimpan terenkripsi dan hanya tampil saat diterbitkan.
            </p>
            {!data.configured ? (
              <p className="text-sm">
                Encryption key belum dikonfigurasi di API.
              </p>
            ) : manage ? (
              <WebhookAction {...actionProps} kind="create" />
            ) : (
              <p className="text-sm text-muted-foreground">
                Hanya admin dapat mengubah endpoint.
              </p>
            )}
            <Link
              href="/docs/api"
              className="inline-flex min-h-11 items-center text-xs text-primary underline"
            >
              Dokumentasi API
            </Link>
          </CardContent>
        </Card>
      </div>
      <Card className="shadow-none">
        <CardContent className="space-y-4 p-6">
          <h2 className="font-semibold">Delivery log</h2>
          <p className="text-xs leading-6 text-muted-foreground">
            Retry otomatis maksimal 24 jam per siklus. Replay memakai event_id
            yang sama dan membuka siklus baru. Status pending belum berarti
            diterima website.
          </p>
          {!data.deliveries.length && (
            <p className="py-6 text-sm text-muted-foreground">
              Belum ada delivery pada halaman ini.
            </p>
          )}
          <div className="space-y-4">
            {data.deliveries.map((d) => (
              <article key={d.id} className="space-y-3 rounded-xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm font-medium">
                    #{d.id} · {d.event_type}
                  </span>
                  <Badge variant="outline">{d.status}</Badge>
                </div>
                <p className="break-all text-xs text-muted-foreground">
                  {d.url}
                </p>
                <p className="break-all font-mono text-xs">
                  Event {d.event_id}
                </p>
                <p className="text-xs leading-6 text-muted-foreground">
                  Percobaan {d.attempt_count} · Replay {d.replay_count} · HTTP{" "}
                  {d.last_http_status ?? "—"}
                  {d.last_error ? ` · ${d.last_error}` : ""}
                  {d.delivered_at
                    ? ` · Diterima ${dateTime(d.delivered_at)} WIB`
                    : ""}
                </p>
                <div className="flex flex-wrap gap-4">
                  <Link
                    className="inline-flex min-h-11 items-center text-xs text-primary underline"
                    href={`${href}?${new URLSearchParams({ ...(before ? { before } : {}), delivery: d.id })}#attempts`}
                  >
                    Lihat percobaan #{d.id}
                  </Link>
                  <Link
                    href={`/dashboard/invoices/${d.invoice_id}`}
                    className="inline-flex min-h-11 items-center text-xs text-primary underline"
                  >
                    Invoice terkait
                  </Link>
                </div>
                {replay && (
                  <WebhookAction {...actionProps} kind="replay" id={d.id} />
                )}
              </article>
            ))}
          </div>
          <nav
            aria-label="Halaman delivery"
            className="flex flex-wrap gap-5 text-sm text-primary"
          >
            {before && (
              <Link
                className="inline-flex min-h-11 items-center underline"
                href={href}
              >
                Delivery terbaru
              </Link>
            )}
            {data.next_cursor && (
              <Link
                className="inline-flex min-h-11 items-center underline"
                href={`${href}?before=${data.next_cursor}`}
              >
                Delivery berikutnya
              </Link>
            )}
          </nav>
        </CardContent>
      </Card>
      {attempts && (
        <Card id="attempts" className="scroll-mt-28 shadow-none">
          <CardContent className="space-y-4 p-6">
            <h2 className="font-semibold">Percobaan delivery #{delivery}</h2>
            {!attempts.items.length && (
              <p className="text-sm text-muted-foreground">
                Belum ada percobaan pengiriman.
              </p>
            )}
            {attempts.items.slice(0, 100).map((a) => (
              <p
                key={a.attempt_no}
                className="break-words rounded-lg border p-3 text-xs leading-7"
              >
                #{a.attempt_no} · {dateTime(a.started_at)} WIB · HTTP{" "}
                {a.http_status ?? "—"} ·{" "}
                {a.error_code ?? (a.finished_at ? "Selesai" : "Berlangsung")}
              </p>
            ))}
            {attempts.items.length > 100 && (
              <p className="text-xs">Menampilkan 100 percobaan terbaru.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
