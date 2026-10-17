import Link from "next/link";
import { Activity, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { adminGet, dateTime } from "@/lib/admin";
import RefreshButton from "../refresh-button";
export const dynamic = "force-dynamic";
const statuses: Record<string, string> = {
  healthy: "Terpantau",
  unhealthy: "Perlu perhatian",
  unknown: "Belum terverifikasi",
  disabled: "Nonaktif",
  running: "Sedang diperiksa",
  clean: "Pemeriksaan lulus",
  findings: "Ada inkonsistensi",
  unavailable: "Belum terverifikasi",
  failed: "Pemeriksaan gagal",
  abandoned: "Terhenti sebelum selesai",
};
const components: Record<string, string> = {
  api: "API gateway",
  scanner: "Scanner blockchain",
  reconciliation: "Rekonsiliasi",
};
const reasons: Record<string, string> = {
  api_reachable: "API dapat dijangkau",
  api_unreachable: "API tidak dapat dijangkau",
  monitoring_disabled: "Pemindaian dinonaktifkan",
  scanner_not_reported: "Worker belum melaporkan status",
  scanner_heartbeat_stale: "Heartbeat worker terlambat",
  scanner_reported_failure: "Worker melaporkan kegagalan",
  scanner_current: "Heartbeat pemindaian tersedia",
  reconciliation_clean: "Pemeriksaan terakhir lulus",
  reconciliation_findings: "Ditemukan inkonsistensi",
  reconciliation_unavailable: "RPC belum dapat memverifikasi",
  database_check_failed: "Pemeriksaan database gagal",
};
const findingLabels: Record<string, string> = {
  paid_credit_missing: "Invoice paid tanpa kredit ledger",
  ledger_mismatch: "Kredit ledger tidak konsisten",
  paid_transfer_credit_missing: "Transfer paid tanpa kredit yang cocok",
  paid_transfer_scope_invalid: "Scope transfer dan invoice tidak sesuai",
  confirmed_event_missing: "Event confirmed belum tercatat",
  confirmed_event_invalid: "Isi event confirmed tidak konsisten",
  chain_mismatch: "Bukti chain berbeda dari catatan",
  chain_unavailable: "Transaksi belum dapat dibaca dari RPC",
  chain_configuration_unavailable:
    "Jaringan atau akun token belum dapat diverifikasi",
};
type Run = {
  id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  snapshot_at?: string | null;
  invoice_count: string;
  finding_count: string;
  chain_checked: number;
  chain_selected: number;
  chain_complete: boolean;
  cursor_start?: string;
  cursor_end?: string | null;
  cycle_completed: boolean;
  error_code: string | null;
};
type Data = {
  components: {
    component: string;
    status: string;
    reason_code: string;
    consecutive_failures: number;
    last_checked_at: string;
    last_success_at: string | null;
    last_alert_at: string | null;
    recent: boolean;
  }[];
  monitor: { started_at: string; updated_at: string; recent: boolean } | null;
  schedule: {
    next_run_at: string;
    cursor_id: string;
    locked_until: string | null;
  } | null;
  runs: Run[];
  next_cursor: string | null;
  selected: Run | null;
  findings: { code: string; entity_type: string; entity_id: string }[];
  samples_truncated: boolean;
};
export default async function Monitoring({
  searchParams,
}: {
  searchParams: Promise<{ before_run?: string; run_id?: string }>;
}) {
  const query = await searchParams,
    qs = new URLSearchParams();
  for (const key of ["before_run", "run_id"] as const)
    if (query[key]) qs.set(key, query[key]!);
  const data = await adminGet<Data>(`monitoring?${qs}`),
    run = data.selected;
  const path = (values: Record<string, string>) =>
    `/dashboard/monitoring?${new URLSearchParams(values)}`;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight">
            <ShieldCheck aria-hidden="true" />
            Monitoring &amp; rekonsiliasi
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
            Ketersediaan API, heartbeat worker dan pemeriksaan konsistensi
            pembayaran. Data memakai scope environment dan jaringan aktif.
          </p>
        </div>
        <RefreshButton />
      </div>
      <div
        role="status"
        className={`rounded-xl border p-4 text-sm leading-7 ${data.monitor?.recent ? "bg-muted/40" : "border-amber-200 bg-amber-50"}`}
      >
        <strong>
          Monitor terpisah:{" "}
          {data.monitor?.recent ? "Heartbeat tersedia" : "Belum terverifikasi"}
        </strong>
        {data.monitor
          ? ` · Pembaruan ${dateTime(data.monitor.updated_at)} WIB`
          : " · Belum ada laporan monitor."}
        <p className="mt-2 text-xs leading-6">
          Monitor berjalan terpisah dari worker utama pada host ini. Gangguan
          seluruh host atau database memerlukan pemantauan eksternal.
        </p>
      </div>
      <section
        aria-label="Status komponen"
        className="grid gap-4 md:grid-cols-3"
      >
        {["api", "scanner", "reconciliation"].map((name) => {
          const c = data.components.find((v) => v.component === name),
            current = Boolean(data.monitor?.recent && c?.recent);
          return (
            <Card key={name} className="shadow-none">
              <CardContent className="space-y-3 p-5">
                <h2 className="font-semibold">{components[name]}</h2>
                <Badge variant="outline">
                  {statuses[current ? c!.status : "unknown"]}
                </Badge>
                <p className="text-xs leading-6 text-muted-foreground">
                  {current
                    ? (reasons[c!.reason_code] ?? c!.reason_code)
                    : "Laporan belum tersedia atau sudah lama."}
                </p>
                {c && (
                  <p className="text-[11px] leading-6 text-muted-foreground">
                    Dicek {dateTime(c.last_checked_at)} WIB · Kegagalan
                    berturut-turut {c.consecutive_failures}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </section>
      <Card className="shadow-none">
        <CardContent className="space-y-4 p-6">
          <h2 className="flex items-center gap-2 font-semibold">
            <Activity size={18} aria-hidden="true" />
            Hasil rekonsiliasi{run ? ` #${run.id}` : ""}
          </h2>
          <p className="text-xs leading-6 text-muted-foreground">
            Jeda 15 menit setelah pemeriksaan selesai. Seluruh invoice diperiksa
            konsistensi database-nya; maksimal 10 transfer paid diverifikasi
            ulang ke RPC finalized per putaran pemeriksaan. Status lulus berlaku
            untuk snapshot database dan batch yang tercantum.
          </p>
          {data.schedule && (
            <p className="text-xs text-muted-foreground">
              Jadwal berikutnya {dateTime(data.schedule.next_run_at)} WIB ·
              Cursor transfer {data.schedule.cursor_id}
            </p>
          )}
          {!run ? (
            <p className="py-6 text-sm text-muted-foreground">
              Belum ada hasil rekonsiliasi.
            </p>
          ) : (
            <>
              <Badge variant="outline">
                {statuses[run.status] ?? run.status}
              </Badge>
              <dl className="grid gap-4 text-sm sm:grid-cols-3">
                {[
                  ["Invoice diperiksa", run.invoice_count],
                  ["Temuan", run.finding_count],
                  [
                    "Transfer batch diperiksa",
                    `${run.chain_checked} / ${run.chain_selected}`,
                  ],
                  ["Mulai (WIB)", dateTime(run.started_at)],
                  [
                    "Selesai (WIB)",
                    run.finished_at
                      ? dateTime(run.finished_at)
                      : "Belum selesai",
                  ],
                  [
                    "Cakupan chain",
                    run.chain_complete
                      ? run.cycle_completed
                        ? "Batch selesai · akhir putaran"
                        : "Batch selesai · histori berlanjut"
                      : "Belum lengkap",
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="mt-2 break-words font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
              {run.snapshot_at && (
                <p className="text-xs text-muted-foreground">
                  Snapshot database {dateTime(run.snapshot_at)} WIB
                </p>
              )}
              {run.error_code && (
                <p className="text-xs leading-6 text-muted-foreground">
                  {reasons[run.error_code] ??
                    (run.error_code === "chain_unavailable"
                      ? "Bukti chain belum tersedia dari RPC."
                      : run.error_code === "lease_expired"
                        ? "Proses sebelumnya terhenti dan lease berakhir."
                        : run.error_code)}
                </p>
              )}
              <div className="space-y-3">
                {data.findings.map((finding, n) => (
                  <article
                    key={`${finding.code}:${finding.entity_id}:${n}`}
                    className="space-y-2 rounded-lg border p-4"
                  >
                    <h3 className="text-sm font-medium">
                      {findingLabels[finding.code] ?? finding.code}
                    </h3>
                    <p className="break-all font-mono text-xs text-muted-foreground">
                      {finding.entity_type} · {finding.entity_id}
                    </p>
                    {finding.entity_type === "invoice" && (
                      <Link
                        href={`/dashboard/invoices/${finding.entity_id}`}
                        className="inline-flex min-h-11 items-center text-xs text-primary underline"
                      >
                        Buka invoice
                      </Link>
                    )}
                  </article>
                ))}
              </div>
              {data.samples_truncated && (
                <p className="text-xs text-muted-foreground">
                  Menampilkan maksimal 100 contoh temuan. Jumlah temuan di atas
                  mencakup hasil yang tidak ditampilkan.
                </p>
              )}
              <p className="text-xs leading-6 text-muted-foreground">
                Hasil pemeriksaan digunakan untuk investigasi. Invoice, ledger,
                webhook dan saldo tidak diubah oleh rekonsiliasi. Saldo wallet
                tidak dibandingkan langsung dengan penerimaan bruto karena dapat
                mencakup transfer lain.
              </p>
            </>
          )}
        </CardContent>
      </Card>
      <Card className="shadow-none">
        <CardContent className="space-y-4 p-6">
          <h2 className="font-semibold">Riwayat pemeriksaan</h2>
          {!data.runs.length && (
            <p className="py-6 text-sm text-muted-foreground">
              Belum ada riwayat pemeriksaan.
            </p>
          )}
          {data.runs.map((item) => (
            <article
              key={item.id}
              className="flex flex-wrap items-start justify-between gap-4 rounded-lg border p-4"
            >
              <div>
                <h3 className="text-sm font-medium">Pemeriksaan #{item.id}</h3>
                <p className="mt-2 text-xs text-muted-foreground">
                  {dateTime(item.started_at)} WIB · Temuan {item.finding_count}{" "}
                  · Batch {item.chain_checked}/{item.chain_selected}
                </p>
                <Link
                  href={path({
                    ...(query.before_run
                      ? { before_run: query.before_run }
                      : {}),
                    run_id: item.id,
                  })}
                  className="inline-flex min-h-11 items-center text-xs text-primary underline"
                >
                  Lihat hasil #{item.id}
                </Link>
              </div>
              <Badge variant="outline">
                {statuses[item.status] ?? item.status}
              </Badge>
            </article>
          ))}
          <nav
            aria-label="Halaman pemeriksaan"
            className="flex flex-wrap gap-5 text-sm text-primary"
          >
            {query.before_run && (
              <Link
                className="inline-flex min-h-11 items-center underline"
                href="/dashboard/monitoring"
              >
                Pemeriksaan terbaru
              </Link>
            )}
            {data.next_cursor && (
              <Link
                className="inline-flex min-h-11 items-center underline"
                href={path({ before_run: data.next_cursor })}
              >
                Pemeriksaan berikutnya
              </Link>
            )}
          </nav>
        </CardContent>
      </Card>
    </div>
  );
}
