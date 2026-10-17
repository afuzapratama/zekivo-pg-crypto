import ProjectTabs from "./tabs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, KeyRound } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  adminGet,
  AdminApiError,
  dateTime,
  type AdminSession,
} from "@/lib/admin";
import { CreateForm, RevokeKey, RotateKey } from "../forms";
type Detail = {
  project: {
    id: string;
    name: string;
    environment: string;
    created_at: string;
  };
  keys: {
    id: string;
    name: string;
    key_prefix: string | null;
    created_at: string;
    revoked_at: string | null;
    expires_at?: string | null;
    replaces_key_id?: string | null;
  }[];
  has_more_keys: boolean;
  next_key_cursor: string | null;
  invoice_counts: { total: string; paid: string };
};
export default async function ProjectDetail({
  params,
  searchParams,
  section = "overview",
}: {
  section?: "overview" | "api-keys";
  params: Promise<{ id: string }>;
  searchParams: Promise<{ before_key?: string }>;
}) {
  const { id } = await params;
  const { before_key } = await searchParams;
  let detail: Detail, session: AdminSession;
  try {
    [detail, session] = await Promise.all([
      adminGet<Detail>(
        `projects/${encodeURIComponent(id)}${before_key ? `?before_key=${encodeURIComponent(before_key)}` : ""}`,
      ),
      adminGet<AdminSession>("auth/session"),
    ]);
  } catch (error) {
    if (error instanceof AdminApiError && [400, 404].includes(error.status))
      notFound();
    throw error;
  }
  const manage = session.permissions.includes("project:manage"),
    reauth = session.reauthentication_required ?? true;
  return (
    <>
      <Link
        href="/dashboard/projects"
        className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        Semua project
      </Link>
      <div className="my-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="break-all text-3xl font-semibold tracking-tight">
            {detail.project.name}
          </h1>
          <p className="mt-3 break-all font-mono text-xs text-muted-foreground">
            {detail.project.id}
          </p>
        </div>
        <Badge variant="outline">{detail.project.environment}</Badge>
      </div>
      <ProjectTabs id={id} section={section} />

      {section === "overview" && (
        <section
          id="project-overview"
          aria-label="Overview project"
          className="mb-7 grid scroll-mt-28 gap-4 sm:grid-cols-3"
        >
          {[
            ["Total invoice", detail.invoice_counts.total],
            ["Invoice paid", detail.invoice_counts.paid],
            ["Dibuat (WIB)", dateTime(detail.project.created_at)],
          ].map(([label, value]) => (
            <Card key={label} className="shadow-none">
              <CardContent className="p-5">
                <h2 className="text-xs text-muted-foreground">{label}</h2>
                <p className="mt-3 text-lg font-semibold">{value}</p>
              </CardContent>
            </Card>
          ))}
        </section>
      )}
      {section === "api-keys" && (
        <div
          id="api-keys"
          className="grid scroll-mt-28 items-start gap-6 xl:grid-cols-[1.5fr_1fr]"
        >
          <Card className="shadow-none">
            <CardContent className="p-6">
              <h2 className="flex items-center gap-2 font-semibold">
                <KeyRound
                  size={18}
                  className="text-primary"
                  aria-hidden="true"
                />
                API keys project
              </h2>
              <p className="my-3 text-xs leading-6 text-muted-foreground">
                Key lengkap tidak ditampilkan kembali. Simpan credential di
                backend integrasi, bukan frontend website.
              </p>
              <div className="mt-5 space-y-4">
                {detail.keys.map((key) => (
                  <article key={key.id} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="break-all text-sm font-medium">
                        {key.name}
                      </h3>
                      <Badge
                        variant="outline"
                        className={
                          key.revoked_at
                            ? "bg-muted text-muted-foreground"
                            : "border-emerald-200 bg-emerald-50 text-emerald-800"
                        }
                      >
                        {key.revoked_at
                          ? "Dicabut"
                          : key.expires_at
                            ? Date.parse(key.expires_at) <= Date.now()
                              ? "Kedaluwarsa"
                              : "Masa transisi"
                            : "Aktif"}
                      </Badge>
                    </div>
                    <code className="mt-3 block break-all text-xs text-muted-foreground">
                      {key.key_prefix
                        ? `${key.key_prefix}…`
                        : "Legacy · prefix belum tersedia"}
                    </code>
                    <p className="mt-2 text-[11px] leading-6 text-muted-foreground">
                      Dibuat {dateTime(key.created_at)} WIB
                      {key.revoked_at
                        ? ` · Dicabut ${dateTime(key.revoked_at)} WIB`
                        : ""}
                    </p>
                    {key.expires_at && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Berlaku sampai {dateTime(key.expires_at)} WIB
                      </p>
                    )}
                    {key.replaces_key_id && (
                      <p className="mt-2 break-all text-xs text-muted-foreground">
                        Pengganti key {key.replaces_key_id}
                      </p>
                    )}
                    {manage && !key.revoked_at && (
                      <RotateKey
                        projectId={id}
                        keyId={key.id}
                        csrf={session.csrf_token}
                        reauth={reauth}
                        scheduled={!!key.expires_at}
                      />
                    )}
                    {manage && !key.revoked_at && (
                      <RevokeKey
                        projectId={id}
                        keyId={key.id}
                        name={key.name}
                        csrf={session.csrf_token}
                        reauth={reauth}
                      />
                    )}
                  </article>
                ))}
                {!detail.keys.length && (
                  <p
                    role="status"
                    className="py-8 text-sm text-muted-foreground"
                  >
                    Belum ada API key pada project ini.
                  </p>
                )}
                <nav
                  aria-label="Halaman API key"
                  className="flex flex-wrap gap-4 text-xs text-primary"
                >
                  {before_key && (
                    <Link
                      href={`/dashboard/projects/${id}/api-keys`}
                      className="inline-flex min-h-11 items-center underline"
                    >
                      Kembali ke key terbaru
                    </Link>
                  )}
                  {detail.next_key_cursor && (
                    <Link
                      href={`/dashboard/projects/${id}/api-keys?before_key=${detail.next_key_cursor}`}
                      className="inline-flex min-h-11 items-center underline"
                    >
                      Key berikutnya
                    </Link>
                  )}
                </nav>
              </div>
            </CardContent>
          </Card>
          <Card className="shadow-none">
            <CardContent className="p-6">
              <h2 className="mb-3 font-semibold">Generate API key</h2>
              {manage ? (
                <CreateForm
                  csrf={session.csrf_token}
                  reauth={reauth}
                  projectId={id}
                />
              ) : (
                <p className="text-sm leading-7 text-muted-foreground">
                  Hanya admin dapat menerbitkan atau mencabut key. Aksesmu saat
                  ini hanya untuk membaca metadata.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
