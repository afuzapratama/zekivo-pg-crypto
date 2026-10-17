import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, ArrowRight } from "lucide-react";
export const dynamic = "force-dynamic";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ reauth?: string }>;
}) {
  const reauth = (await searchParams).reauth === "1";
  let enabled = false;
  let authenticated = false;
  try {
    const response = await fetch(
      new URL(
        "/admin/auth/session",
        process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4100",
      ),
      {
        headers: { cookie: (await cookies()).toString() },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      },
    );
    authenticated = response.ok;
    enabled = response.status === 401 || (reauth && response.ok);
  } catch {
    /* API unavailable: keep login closed. */
  }
  if (authenticated && !reauth) redirect("/dashboard");
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-5 py-12">
      <div className="w-full max-w-md">
        <a
          href="/"
          className="mb-8 inline-flex items-center gap-3 font-semibold"
        >
          <span className="grid size-9 place-items-center rounded-lg bg-primary text-white">
            z.
          </span>
          zekivo pay
        </a>
        <Card className="shadow-none">
          <CardContent className="p-7 sm:p-9">
            <Badge variant="outline">OPERATOR WORKSPACE</Badge>
            <ShieldCheck
              className="my-6 size-9 text-primary"
              aria-hidden="true"
            />
            <h1 className="text-2xl font-semibold tracking-tight">
              Masuk ke dashboard.
            </h1>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              Kelola aktivitas pembayaran Zekivo menggunakan akun perusahaan
              yang telah diberi akses.
            </p>
            {enabled ? (
              <form
                action="/api/admin/auth/login"
                method="post"
                className="mt-7"
              >
                <Button className="min-h-11 w-full" type="submit">
                  Masuk dengan Microsoft <ArrowRight aria-hidden="true" />
                </Button>
              </form>
            ) : (
              <p
                role="status"
                className="mt-7 rounded-lg border bg-muted/40 p-4 text-sm leading-6"
              >
                Login perusahaan belum tersedia. Administrator perlu
                menyelesaikan konfigurasi Microsoft Entra sebelum akses
                dashboard dibuka.
              </p>
            )}
            <p className="mt-6 text-xs leading-6 text-muted-foreground">
              Akses dibatasi sesuai peran. Gunakan kebijakan MFA perusahaan saat
              masuk.
            </p>
          </CardContent>
        </Card>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Zekivo · Payment operations
        </p>
      </div>
    </main>
  );
}
