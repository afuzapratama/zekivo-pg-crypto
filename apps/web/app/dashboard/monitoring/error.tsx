"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function MonitoringError({ reset }: { reset: () => void }) {
  return (
    <section className="rounded-xl border bg-white p-7">
      <h1 className="text-xl font-semibold">Monitoring belum dapat dimuat.</h1>
      <p role="alert" className="my-4 text-sm text-muted-foreground">
        Periksa koneksi atau session, lalu coba lagi. Tidak ada credential yang
        ditampilkan.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => reset()} className="min-h-11">
          Coba lagi
        </Button>
        <Button variant="outline" asChild className="min-h-11">
          <Link href="/dashboard">Kembali ke dashboard</Link>
        </Button>
      </div>
    </section>
  );
}
