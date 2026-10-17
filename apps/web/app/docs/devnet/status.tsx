"use client";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
export default function Status() {
  const [status, setStatus] = useState("Memeriksa gateway Devnet…");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    void fetch("/api/devnet/status", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const data = await r.json();
        if (data.cluster !== "devnet" || data.environment !== "staging")
          throw new Error();
        setStatus(
          data.ready
            ? "Gateway Devnet siap menerima invoice."
            : "Gateway belum siap. Jangan kirim pembayaran sebelum checkout menampilkan instruksi aktif.",
        );
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setStatus(
            "Status gateway belum dapat dipastikan. Periksa layanan Devnet lalu muat ulang.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [reload]);
  return (
    <Card className="mt-6 shadow-none">
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
        <p role="status" className="text-sm font-medium">
          {status}
        </p>
        <Button
          variant="outline"
          disabled={busy}
          className="min-h-11"
          onClick={() => setReload((v) => v + 1)}
        >
          <RefreshCw aria-hidden="true" />
          Cek gateway
        </Button>
      </CardContent>
    </Card>
  );
}
