"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export function WebhookAction({
  projectId,
  csrf,
  reauth,
  kind,
  id,
}: {
  projectId: string;
  csrf: string;
  reauth: boolean;
  kind: "create" | "rotate" | "replay";
  id?: string;
}) {
  const router = useRouter();
  const requestId = useRef<string | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState("");
  const [needLogin, setNeedLogin] = useState(reauth);
  const label =
    kind === "create"
      ? "Tambah endpoint"
      : kind === "rotate"
        ? "Rotasi secret"
        : "Replay delivery";
  async function submit() {
    setBusy(true);
    setMessage("");
    requestId.current ??= crypto.randomUUID();
    try {
      const path =
        kind === "create"
          ? "webhook-endpoints"
          : kind === "rotate"
            ? `webhook-endpoints/${id}/rotate-secret`
            : `webhook-deliveries/${id}/replay`;
      const response = await fetch(`/api/admin/projects/${projectId}/${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf,
          "Idempotency-Key": requestId.current,
        },
        body: JSON.stringify(kind === "create" ? { url } : {}),
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.error === "reauthentication_required") setNeedLogin(true);
        const errors: Record<string, string> = {
          invalid_webhook_target:
            "Gunakan HTTPS pada port 443 dan domain dengan IP publik.",
          endpoint_exists: "Endpoint ini sudah terdaftar.",
          secret_already_issued:
            "Permintaan ini sudah selesai. Secret tidak dapat ditampilkan ulang. Periksa daftar endpoint sebelum melakukan rotasi baru.",
          delivery_inflight: "Delivery sedang dikirim. Tunggu sampai selesai.",
          webhooks_not_configured:
            "Encryption key webhook belum dikonfigurasi.",
          reauthentication_required: "Login ulang untuk melanjutkan.",
          request_outcome_unknown:
            "Hasil permintaan belum diketahui. Coba lagi dengan permintaan yang sama atau periksa daftar terlebih dahulu.",
        };
        setMessage(
          errors[data.error] ?? `Permintaan gagal (${response.status}).`,
        );
        return;
      }
      if (data.signing_secret) setSecret(data.signing_secret);
      else {
        setMessage(
          "Delivery masuk antrean. Status terkirim menunggu hasil worker.",
        );
        router.refresh();
      }
      setConfirm(false);
    } catch {
      setMessage(
        "Hasil permintaan belum diketahui. Periksa daftar atau coba lagi dengan permintaan yang sama.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (needLogin)
    return (
      <p className="text-sm leading-7 text-muted-foreground">
        <Link href="/login?reauth=1" className="text-primary underline">
          Login ulang Microsoft
        </Link>{" "}
        untuk mengubah pengaturan atau replay.
      </p>
    );
  if (secret)
    return (
      <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
        <p className="text-sm font-medium">Signing secret · tampil satu kali</p>
        <p className="text-xs leading-6">
          Simpan di backend penerima webhook. Jangan masukkan ke frontend.
        </p>
        <code className="block break-all text-xs">{secret}</code>
        <Button
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(secret);
              setMessage("Secret disalin.");
            } catch {
              setMessage(
                "Clipboard tidak tersedia. Salin secret secara manual.",
              );
            }
          }}
        >
          Salin secret
        </Button>
        <Button
          className="ml-2"
          onClick={() => {
            setSecret("");
            setMessage("");
            setUrl("");
            requestId.current = null;
            router.refresh();
          }}
        >
          Sudah disimpan
        </Button>
        <p role="status" className="text-xs">
          {message}
        </p>
      </div>
    );
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (kind !== "create" && !confirm) {
          setConfirm(true);
          return;
        }
        void submit();
      }}
    >
      {kind === "create" && (
        <div>
          <label htmlFor="webhook-url" className="mb-2 block text-sm">
            URL webhook HTTPS
          </label>
          <Input
            id="webhook-url"
            type="url"
            placeholder="https://example.com/webhooks/zekivo"
            required
            maxLength={2048}
            value={url}
            disabled={busy}
            onChange={(e) => {
              setUrl(e.target.value);
              requestId.current = null;
              setMessage("");
            }}
          />
        </div>
      )}
      {confirm && (
        <p className="text-xs leading-6 text-muted-foreground">
          {kind === "rotate"
            ? "Secret lama langsung berhenti berlaku, termasuk untuk retry berikutnya. Siapkan pembaruan secret di backend penerima."
            : "Event yang sama akan dikirim ulang. Penerima wajib melakukan deduplikasi berdasarkan event_id."}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant={kind === "create" ? "default" : "outline"}
          disabled={busy}
        >
          {busy ? "Memproses…" : confirm ? "Ya, lanjutkan" : label}
        </Button>
        {confirm && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => setConfirm(false)}
          >
            Batal
          </Button>
        )}
      </div>
      {message && (
        <p role="status" className="break-words text-xs leading-6">
          {message}
        </p>
      )}
    </form>
  );
}
