"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Code2, RefreshCw, ArrowUpRight } from "lucide-react";
import styles from "./docs.module.css";
const Scalar = dynamic(() => import("./scalar"), {
  ssr: false,
  loading: () => (
    <p role="status" className="p-6 text-sm text-muted-foreground">
      Menyiapkan API explorer…
    </p>
  ),
});
export default function Reference() {
  const [content, setContent] = useState<string | null>(null);
  const [state, setState] = useState("loading");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/openapi", {
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const spec = await response.json();
        if (!spec.openapi || !spec.paths) throw new Error();
        if (!controller.signal.aborted) {
          setContent(JSON.stringify(spec));
          setState("ready");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("error");
      });
    return () => controller.abort();
  }, [retry]);
  const stableContent = useMemo(() => content, [content]);
  return (
    <>
      {state === "error" && (
        <div className={styles.block}>
          <Code2 className="mb-4 text-muted-foreground" aria-hidden="true" />
          <h2>API reference belum tersedia</h2>
          <p role="status">
            Pastikan API gateway berjalan. Untuk hosting non-local,
            API_PUBLIC_URL perlu menunjuk alamat publik gateway. Kamu tetap
            dapat membaca panduan integrasi.
          </p>
          <Button
            variant="outline"
            className="mt-4 min-h-11"
            onClick={() => {
              setState("loading");
              setRetry((v) => v + 1);
            }}
          >
            <RefreshCw aria-hidden="true" />
            Muat ulang referensi API
          </Button>
        </div>
      )}
      {state === "loading" && (
        <p
          role="status"
          className="rounded-lg border bg-white p-6 text-sm text-muted-foreground"
        >
          Memuat kontrak OpenAPI dari gateway…
        </p>
      )}
      {state === "ready" && stableContent && (
        <>
          <p className="my-5 text-xs leading-6 text-muted-foreground">
            Try it mengirim request ke server API yang dipilih. Masukkan API key
            sandbox milikmu sendiri pada Authorization.{" "}
            <a
              href="/docs/playground"
              className="inline-flex items-center gap-1 font-medium text-primary"
            >
              Uji pembayaran lengkap di playground{" "}
              <ArrowUpRight size={12} aria-hidden="true" />
            </a>
          </p>
          <div className={styles.reference}>
            <Scalar content={stableContent} />
          </div>
        </>
      )}
    </>
  );
}
