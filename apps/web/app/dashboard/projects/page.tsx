import Link from "next/link";
import { FolderKey, ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  adminGet,
  type AdminSession,
  type Project,
  dateTime,
} from "@/lib/admin";
import { CreateForm } from "./forms";
export const dynamic = "force-dynamic";
export default async function Projects() {
  const [session, projects] = await Promise.all([
    adminGet<AdminSession>("auth/session"),
    adminGet<{ items: (Project & { created_at?: string })[] }>("projects"),
  ]);
  const manage = session.permissions.includes("project:manage");
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">
        Project integrasi.
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
        Satu project untuk satu website atau aplikasi. Setiap project memiliki
        credential, invoice, dan konfigurasi integrasinya sendiri dalam
        environment ini.
      </p>
      <div className="mt-8 grid items-start gap-6 xl:grid-cols-[1.5fr_1fr]">
        <section
          aria-label="Daftar project"
          className="grid gap-4 sm:grid-cols-2"
        >
          {projects.items.map((project) => (
            <Card key={project.id} className="shadow-none">
              <CardContent className="p-6">
                <div className="mb-5 grid size-10 place-items-center rounded-xl bg-secondary text-primary">
                  <FolderKey size={21} aria-hidden="true" />
                </div>
                <h2 className="break-all font-semibold">{project.name}</h2>
                <p className="mt-2 break-all font-mono text-[10px] leading-6 text-muted-foreground">
                  {project.id}
                </p>
                {project.created_at && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Dibuat {dateTime(project.created_at)} WIB
                  </p>
                )}
                <Link
                  href={`/dashboard/projects/${project.id}`}
                  className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary"
                >
                  Buka project <ArrowUpRight size={14} aria-hidden="true" />
                </Link>
              </CardContent>
            </Card>
          ))}
          {!projects.items.length && (
            <p
              role="status"
              className="rounded-xl border bg-white p-6 text-sm text-muted-foreground"
            >
              Belum ada project pada environment ini.
            </p>
          )}
        </section>
        <Card className="shadow-none">
          <CardContent className="p-6">
            <h2 className="mb-3 font-semibold">Project baru</h2>
            {manage ? (
              <CreateForm
                csrf={session.csrf_token}
                reauth={session.reauthentication_required ?? true}
              />
            ) : (
              <p className="text-sm leading-7 text-muted-foreground">
                Pembuatan project hanya tersedia untuk admin. Kamu tetap dapat
                melihat project dan metadata key.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
