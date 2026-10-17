"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Reauthenticate } from "../../../projects/forms";
export default function RefundForm({
  id,
  csrf,
  reauth,
}: {
  id: string;
  csrf: string;
  reauth: boolean;
}) {
  const router = useRouter(),
    requestId = useRef<string | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [needsAuth, setNeedsAuth] = useState(false);
  if (reauth || needsAuth) return <Reauthenticate />;
  return (
    <form
      className="space-y-4"
      onChange={() => {
        requestId.current = null;
        setSaved(false);
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        setSaved(false);
        requestId.current ??= crypto.randomUUID();
        const form = event.currentTarget,
          data = new FormData(form);
        try {
          const response = await fetch(`/api/admin/invoices/${id}/refunds`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-csrf-token": csrf,
              "Idempotency-Key": requestId.current,
            },
            body: JSON.stringify({
              ...Object.fromEntries(data),
              destination_confirmed: data.get("destination_confirmed") === "on",
            }),
          });
          const result = await response.json();
          if (!response.ok) {
            const messages: Record<string, string> = {
              refund_proof_mismatch:
                "Bukti tidak cocok dengan sumber treasury, tujuan, token, nominal, atau waktu invoice.",
              refund_verification_unavailable:
                "Bukti finalized belum dapat diverifikasi. Tunggu lalu coba lagi dengan data yang sama.",
              refund_exceeds_payment:
                "Total refund tercatat melebihi kredit pembayaran pada aset ini.",
              refund_proof_already_used:
                "Instruksi transaksi ini sudah dicatat sebagai refund.",
              refund_requires_paid_invoice:
                "Pencatatan ini hanya tersedia untuk invoice paid.",
              idempotency_conflict:
                "Permintaan sudah digunakan untuk data lain. Muat ulang dan periksa riwayat.",
              invalid_refund: "Alamat, nominal atau catatan belum valid.",
              forbidden: "Akun tidak memiliki izin mencatat refund.",
              unauthorized: "Session berakhir. Masuk kembali.",
              invalid_csrf: "Session berubah. Muat ulang halaman.",
              reauthentication_required:
                "Verifikasi ulang Microsoft diperlukan.",
            };
            setNeedsAuth(result.error === "reauthentication_required");
            setError(
              messages[result.error] ??
                "Hasil belum dapat dipastikan. Periksa riwayat sebelum retry dengan data yang sama.",
            );
            return;
          }
          setSaved(true);
          form.reset();
          requestId.current = null;
          router.refresh();
        } catch {
          setError(
            "Hasil belum dapat dipastikan. Periksa riwayat, lalu retry data yang sama; jangan mengirim dana lagi.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy} className="space-y-4">
        <label className="block space-y-2 text-sm">
          Aset
          <select
            name="asset"
            className="min-h-11 w-full rounded-md border bg-white px-3"
          >
            <option value="USDC">USDC</option>
            <option value="USDT">USDT (Mock pada Devnet)</option>
          </select>
        </label>
        {[
          ["amount", "Nominal refund", "1.000001", 32],
          [
            "destination",
            "Alamat wallet tujuan",
            "Alamat owner Solana, bukan token account",
            44,
          ],
          [
            "signature",
            "Signature transaksi refund",
            "Signature finalized",
            88,
          ],
          ["instruction_path", "Instruction path", "Contoh: 2 atau 2.0", 9],
          [
            "reason",
            "Alasan refund",
            "Contoh: pesanan dibatalkan oleh pembeli",
            2000,
          ],
          [
            "destination_verification",
            "Bukti konfirmasi alamat tujuan",
            "Contoh: dikonfirmasi lewat tiket dukungan #123",
            1000,
          ],
        ].map(([name, label, placeholder, max]) => (
          <label key={name} className="block space-y-2 text-sm">
            {label}
            <Input
              name={String(name)}
              placeholder={String(placeholder)}
              maxLength={Number(max)}
              required
              className="min-h-11"
            />
          </label>
        ))}
        <label className="flex items-start gap-3 text-sm leading-6">
          <input
            type="checkbox"
            name="destination_confirmed"
            required
            className="mt-1 size-4 shrink-0"
          />
          Saya sudah mengonfirmasi alamat tujuan melalui kanal pembeli yang
          tepercaya.
        </label>
        <Button type="submit" className="min-h-11" disabled={busy}>
          {busy ? "Memverifikasi blockchain…" : "Verifikasi & catat refund"}
        </Button>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-primary">
          Refund finalized berhasil diverifikasi dan dicatat.
        </p>
      )}
    </form>
  );
}
