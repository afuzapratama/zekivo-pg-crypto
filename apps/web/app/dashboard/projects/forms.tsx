"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, KeyRound, Plus, ShieldCheck } from "lucide-react";
const messages: Record<string, string> = {
  reauthentication_required:
    "Verifikasi ulang akun Microsoft diperlukan sebelum melanjutkan.",
  key_already_created:
    "Key sudah dibuat pada permintaan ini. Nilai lengkap tidak bisa ditampilkan kembali. Jika belum disimpan, cabut key tersebut dan buat permintaan baru.",
  idempotency_conflict:
    "Identitas permintaan sudah digunakan untuk data berbeda. Mulai permintaan baru.",
  invalid_csrf: "Session berubah. Muat ulang halaman sebelum melanjutkan.",
  forbidden: "Akses untuk tindakan ini tidak tersedia.",
  unauthorized: "Session berakhir. Masuk kembali untuk melanjutkan.",
  key_not_rotatable:
    "Key ini sudah dicabut atau sudah menjalani rotasi. Perbarui daftar key.",
  not_found: "Project atau key tidak ditemukan.",
  request_outcome_unknown:
    "Hasil permintaan belum dapat dipastikan. Periksa daftar terlebih dahulu; retry dengan permintaan sama tidak membuat key kedua.",
};
export function Reauthenticate() {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <div className="flex items-center gap-2 font-medium">
        <ShieldCheck size={17} aria-hidden="true" />
        Verifikasi akun untuk aksi sensitif
      </div>
      <p className="my-3 text-xs leading-6">
        Tindakan pengelolaan sensitif, termasuk pencatatan refund, memerlukan
        autentikasi Microsoft dalam 10 menit terakhir. Setelah verifikasi, buka
        kembali project ini.
      </p>
      <Button variant="outline" asChild className="min-h-11 bg-white">
        <Link href="/login?reauth=1">Verifikasi ulang Microsoft</Link>
      </Button>
    </div>
  );
}
export function CreateForm({
  csrf,
  reauth,
  projectId,
  rotateKeyId,
  rotationClosed = false,
}: {
  csrf: string;
  reauth: boolean;
  projectId?: string;
  rotateKeyId?: string;
  rotationClosed?: boolean;
}) {
  const router = useRouter(),
    requestId = useRef<string | null>(null);
  const [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [raw, setRaw] = useState(""),
    [copied, setCopied] = useState(false),
    [needsAuth, setNeedsAuth] = useState(false);
  const [overlap, setOverlap] = useState("24");
  const key = !!projectId;
  return (
    <div className="space-y-4">
      {(reauth || needsAuth) && <Reauthenticate />}
      {raw ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <h3 className="flex items-center gap-2 font-semibold">
            <KeyRound size={17} aria-hidden="true" />
            {rotateKeyId
              ? "Key pengganti berhasil dibuat"
              : "API key berhasil dibuat"}
          </h3>
          <p className="my-3 text-xs leading-6">
            Simpan di secret manager atau environment backend website. Nilai
            lengkap hanya ditampilkan kali ini.
          </p>
          <code className="block select-all break-all rounded-lg border bg-white p-4 text-xs leading-6">
            {raw}
          </code>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              className="min-h-11 bg-white"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(raw);
                  setCopied(true);
                } catch {
                  setError(
                    "Clipboard tidak tersedia. Salin key secara manual dari kotak di atas.",
                  );
                }
              }}
            >
              <Copy size={15} aria-hidden="true" />
              {copied ? "Tersalin" : "Salin key"}
            </Button>
            <Button
              type="button"
              className="min-h-11"
              onClick={() => {
                setRaw("");
                setName("");
                setError("");
                setCopied(false);
                requestId.current = null;
                router.refresh();
              }}
            >
              Sudah disimpan
            </Button>
          </div>
        </div>
      ) : rotationClosed ? (
        <p className="text-xs text-muted-foreground">
          Rotasi sudah dijadwalkan. Key pengganti tersedia pada daftar; nilai
          lengkap hanya ditampilkan saat diterbitkan.
        </p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setError("");
            requestId.current ??= crypto.randomUUID();
            try {
              const response = await fetch(
                projectId
                  ? `/api/admin/projects/${projectId}/api-keys${rotateKeyId ? `/${rotateKeyId}/rotate` : ""}`
                  : "/api/admin/projects",
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "x-csrf-token": csrf,
                    "Idempotency-Key": requestId.current,
                  },
                  body: JSON.stringify({
                    name: name.trim(),
                    ...(rotateKeyId ? { overlap_hours: Number(overlap) } : {}),
                  }),
                },
              );
              const data = await response.json();
              if (!response.ok) {
                setNeedsAuth(data.error === "reauthentication_required");
                setError(
                  messages[data.error] ??
                    "Permintaan belum berhasil. Periksa data dan coba lagi.",
                );
                if (data.error === "key_already_created") router.refresh();
                return;
              }
              if (key) {
                setRaw(data.api_key);
                router.refresh();
              } else router.push(`/dashboard/projects/${data.id}`);
            } catch {
              setError(messages.request_outcome_unknown);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="block space-y-2 text-xs font-medium">
            {key ? "Nama API key" : "Nama project"}
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                requestId.current = null;
              }}
              placeholder={
                key
                  ? "Contoh: backend commerce devnet"
                  : "Contoh: Zekivo Commerce"
              }
              required
              minLength={1}
              maxLength={128}
              className="min-h-11"
              disabled={busy || reauth || needsAuth}
            />
          </label>
          {rotateKeyId && (
            <label className="block space-y-2 text-xs font-medium">
              Masa transisi key lama
              <select
                aria-label="Masa transisi key lama"
                className="min-h-11 w-full rounded-md border bg-white px-3"
                value={overlap}
                disabled={busy || reauth || needsAuth}
                onChange={(e) => {
                  setOverlap(e.target.value);
                  requestId.current = null;
                }}
              >
                <option value="1">1 jam</option>
                <option value="24">24 jam</option>
                <option value="72">72 jam</option>
              </select>
              <span className="block font-normal leading-6 text-muted-foreground">
                Key lama otomatis berhenti berlaku setelah masa transisi. Pasang
                key baru di backend website sebelum batas waktu tersebut.
              </span>
            </label>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              disabled={busy || reauth || needsAuth || !name.trim()}
              className="min-h-11"
            >
              <Plus size={16} aria-hidden="true" />
              {busy
                ? "Memproses…"
                : rotateKeyId
                  ? "Terbitkan key pengganti"
                  : key
                    ? "Generate API key"
                    : "Buat project"}
            </Button>
            {error && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                className="min-h-11"
                onClick={() => {
                  requestId.current = null;
                  setError("");
                }}
              >
                Permintaan baru
              </Button>
            )}
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm leading-6 text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
export function RevokeKey({
  projectId,
  keyId,
  name,
  csrf,
  reauth,
}: {
  projectId: string;
  keyId: string;
  name: string;
  csrf: string;
  reauth: boolean;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [needsAuth, setNeedsAuth] = useState(false);
  return (
    <div className="mt-3">
      {needsAuth || reauth ? (
        <p className="text-xs text-muted-foreground">
          <Link className="text-primary underline" href="/login?reauth=1">
            Verifikasi ulang
          </Link>{" "}
          sebelum mencabut key.
        </p>
      ) : !confirm ? (
        <Button
          type="button"
          variant="outline"
          className="min-h-11 text-destructive"
          onClick={() => setConfirm(true)}
        >
          Cabut key
        </Button>
      ) : (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium">Cabut {name}?</p>
          <p className="mt-2 text-xs leading-6">
            Permintaan baru menggunakan key ini akan ditolak. Invoice dan
            pembayaran sebelumnya tetap tercatat.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button
              type="button"
              variant="destructive"
              className="min-h-11"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const response = await fetch(
                    `/api/admin/projects/${projectId}/api-keys/${keyId}/revoke`,
                    { method: "POST", headers: { "x-csrf-token": csrf } },
                  );
                  const data = await response.json();
                  if (!response.ok) {
                    setNeedsAuth(data.error === "reauthentication_required");
                    setError(
                      messages[data.error] ?? "Pencabutan belum berhasil.",
                    );
                    return;
                  }
                  setConfirm(false);
                  router.refresh();
                } catch {
                  setError(
                    "Hasil pencabutan belum dapat dipastikan. Perbarui daftar sebelum mencoba lagi.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Mencabut…" : "Ya, cabut key"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              className="min-h-11 bg-white"
              onClick={() => setConfirm(false)}
            >
              Batal
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function RotateKey(props: {
  projectId: string;
  keyId: string;
  csrf: string;
  reauth: boolean;
  scheduled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="mt-3 rounded-lg border p-3"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sm font-medium">
        Rotasi key
      </summary>
      {open && (
        <div className="mt-4">
          <CreateForm
            csrf={props.csrf}
            reauth={props.reauth}
            projectId={props.projectId}
            rotateKeyId={props.keyId}
            rotationClosed={props.scheduled}
          />
        </div>
      )}
    </details>
  );
}
