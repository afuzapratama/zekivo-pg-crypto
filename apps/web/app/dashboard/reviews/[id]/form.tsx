"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { reviewLabels } from "../types";
export default function ReviewForm({
  id,
  csrf,
  status,
  version,
  reauth,
}: {
  id: string;
  csrf: string;
  status: string;
  version: number;
  reauth: boolean;
}) {
  const router = useRouter(),
    requestId = useRef<string | null>(null);
  const [target, setTarget] = useState(status),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [message, setMessage] = useState(""),
    [needLogin, setNeedLogin] = useState(reauth),
    [saved, setSaved] = useState(false),
    [conflict, setConflict] = useState(false);
  if (needLogin)
    return (
      <p className="text-sm leading-7">
        <Link className="text-primary underline" href="/login?reauth=1">
          Login ulang Microsoft
        </Link>{" "}
        untuk mencatat penanganan.
      </p>
    );
  async function save() {
    setBusy(true);
    setMessage("");
    requestId.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/admin/reviews/${id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf,
          "Idempotency-Key": requestId.current,
        },
        body: JSON.stringify({
          status: target,
          reason: reason.trim(),
          expected_version: version,
        }),
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.error === "reauthentication_required") setNeedLogin(true);
        if (data.error === "review_changed") setConflict(true);
        setMessage(
          data.error === "review_changed"
            ? "Review sudah diperbarui operator lain. Muat ulang sebelum melanjutkan."
            : data.error === "idempotency_conflict"
              ? "Identitas permintaan sudah digunakan. Muat ulang dan periksa riwayat."
              : "Penyimpanan belum berhasil dipastikan. Periksa riwayat atau coba lagi dengan permintaan yang sama.",
        );
        return;
      }
      setSaved(true);
      setReason("");
      setConfirm(false);
      setMessage(
        "Catatan penanganan tersimpan. Status pembayaran invoice tetap mengikuti verifikasi chain.",
      );
      router.refresh();
    } catch {
      setMessage(
        "Hasil penyimpanan belum diketahui. Coba lagi dengan permintaan yang sama atau periksa riwayat.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (saved)
    return (
      <p
        role="status"
        className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm leading-7 text-emerald-900"
      >
        {message}
      </p>
    );
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!confirm) {
          setConfirm(true);
          return;
        }
        void save();
      }}
    >
      <label className="block text-sm">
        Status penanganan
        <select
          className="mt-2 min-h-11 w-full rounded-md border bg-white px-3 text-sm"
          value={target}
          disabled={busy || confirm || conflict}
          onChange={(e) => {
            setTarget(e.target.value);
            requestId.current = null;
          }}
        >
          {Object.entries(reviewLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Alasan dan bukti penanganan
        <textarea
          required
          minLength={10}
          maxLength={2000}
          rows={5}
          value={reason}
          disabled={busy || confirm || conflict}
          onChange={(e) => {
            setReason(e.target.value);
            requestId.current = null;
          }}
          className="mt-2 w-full rounded-md border bg-white p-3 text-sm"
          placeholder="Catat hasil pemeriksaan transfer dan tindak lanjut yang dilakukan."
        />
      </label>
      <p className="text-xs leading-6 text-muted-foreground">
        10–2.000 karakter. Jangan mencatat secret, API key, atau data pribadi
        pembeli.
      </p>
      {confirm && (
        <p className="rounded-lg border bg-muted/40 p-3 text-xs leading-6">
          Simpan status “{reviewLabels[target]}” dan alasan ini? Menutup review
          hanya menutup pekerjaan pemeriksaan; invoice, ledger, webhook dan
          saldo tidak diubah.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          disabled={busy || conflict || reason.trim().length < 10}
        >
          {busy
            ? "Menyimpan…"
            : confirm
              ? "Ya, simpan catatan"
              : "Simpan penanganan"}
        </Button>
        {confirm && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setConfirm(false)}
          >
            Batal
          </Button>
        )}
        {conflict && (
          <Button
            type="button"
            variant="outline"
            onClick={() => window.location.reload()}
          >
            Muat ulang review
          </Button>
        )}
      </div>
      {message && (
        <p role="alert" className="text-xs leading-6">
          {message}
        </p>
      )}
    </form>
  );
}
