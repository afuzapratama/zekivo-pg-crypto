"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export type Channel = {
  channel: string;
  enabled: boolean;
  version: number;
  config?: Record<string, string | number | boolean>;
};
export default function ChannelForm({
  channel,
  value,
  csrf,
  reauth,
  keyReady,
  allowMailpit,
}: {
  channel: "email" | "telegram";
  value?: Channel;
  csrf: string;
  reauth: boolean;
  keyReady: boolean;
  allowMailpit: boolean;
}) {
  const [refreshing, startRefresh] = useTransition();
  const router = useRouter(),
    requestId = useRef<string | null>(null);
  const [config, setConfig] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(value?.config ?? {})
        .filter(([k]) => !k.endsWith("_set"))
        .map(([k, v]) => [k, String(v)]),
    ),
  );
  const [enabled, setEnabled] = useState(value?.enabled ?? false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [needLogin, setNeedLogin] = useState(reauth),
    [conflict, setConflict] = useState(false),
    [confirm, setConfirm] = useState(false);
  async function submit(action: "save" | "test") {
    setBusy(true);
    setMessage("");
    requestId.current ??= crypto.randomUUID();
    try {
      const response = await fetch(
        `/api/admin/notifications/${channel}${action === "test" ? "/test" : ""}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf,
            "Idempotency-Key": requestId.current,
          },
          body: JSON.stringify(
            action === "test"
              ? {}
              : {
                  enabled,
                  expected_version: value?.version ?? 0,
                  config:
                    channel === "email"
                      ? { ...config, port: Number(config.port ?? 587) }
                      : config,
                },
          ),
          cache: "no-store",
        },
      );
      const data = await response.json();
      if (!response.ok) {
        if (data.error === "reauthentication_required") setNeedLogin(true);
        if (data.error === "settings_changed") setConflict(true);
        setMessage(
          data.error === "settings_changed"
            ? "Konfigurasi sudah berubah. Muat ulang halaman sebelum menyimpan."
            : data.error === "invalid_channel_config"
              ? "Periksa format konfigurasi. Untuk konfigurasi pertama, password atau bot token wajib diisi."
              : "Hasil permintaan belum dapat dipastikan. Periksa log sebelum mencoba ulang.",
        );
        return;
      }
      setMessage(
        action === "save"
          ? "Konfigurasi tersimpan."
          : "Pesan uji masuk antrean. Lihat hasil pengiriman di log.",
      );
      setConfig((c) => ({
        ...c,
        ...(channel === "email"
          ? c.mode === "mailpit"
            ? {}
            : { password: "" }
          : { bot_token: "" }),
      }));
      setConfirm(false);
      requestId.current = null;
      startRefresh(() => router.refresh());
    } catch {
      setMessage(
        "Hasil permintaan belum diketahui. Periksa log atau coba permintaan yang sama.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (needLogin)
    return (
      <p className="text-sm leading-7">
        <Link className="text-primary underline" href="/login?reauth=1">
          Login ulang Microsoft
        </Link>{" "}
        untuk mengubah pengaturan notifikasi.
      </p>
    );
  if (!keyReady)
    return (
      <p className="text-sm leading-7 text-muted-foreground">
        Encryption key notifikasi belum dikonfigurasi pada API/worker.
        Notifikasi tetap tercatat di antrean.
      </p>
    );
  const mailpit = channel === "email" && config.mode === "mailpit";
  const fields =
    channel === "email"
      ? [
          ["host", "SMTP host", "text"],
          ...(!mailpit
            ? [
                ["username", "SMTP username", "text"],
                ["password", "SMTP password", "password"],
              ]
            : []),
          ["from", "Email pengirim", "email"],
          ["to", "Email admin penerima", "email"],
        ]
      : [
          ["bot_token", "Telegram bot token", "password"],
          ["chat_id", "Telegram chat ID", "text"],
        ];
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit("save");
      }}
    >
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy || refreshing || conflict}
          onChange={(e) => {
            setEnabled(e.target.checked);
            requestId.current = null;
          }}
        />
        Aktifkan {channel === "email" ? "email SMTP" : "Telegram"}
      </label>
      {channel === "email" && allowMailpit && (
        <label className="block text-xs font-medium">
          Mode SMTP
          <select
            className="mt-2 min-h-11 w-full rounded-md border bg-white px-3 text-sm"
            value={config.mode ?? "smtp"}
            disabled={busy || refreshing || conflict}
            onChange={(e) => {
              const mode = e.target.value;
              setConfig({
                mode,
                host: mode === "mailpit" ? "host.docker.internal" : "",
                port: mode === "mailpit" ? "1025" : "587",
                from: config.from ?? "",
                to: config.to ?? "",
              });
              requestId.current = null;
            }}
          >
            <option value="smtp">SMTP publik · TLS</option>
            <option value="mailpit">Mailpit lokal · port 1025</option>
          </select>
        </label>
      )}
      {fields.map(([name, label, type]) => (
        <div key={name}>
          <label
            htmlFor={`${channel}-${name}`}
            className="mb-2 block text-xs font-medium"
          >
            {label}
          </label>
          <Input
            id={`${channel}-${name}`}
            type={type}
            autoComplete={type === "password" ? "new-password" : "off"}
            maxLength={name === "password" ? 1024 : 254}
            disabled={busy || refreshing || conflict}
            value={config[name!] ?? ""}
            placeholder={
              type === "password" && value
                ? "Kosongkan untuk mempertahankan secret"
                : ""
            }
            required={type !== "password" || !value}
            onChange={(e) => {
              setConfig((c) => ({ ...c, [name!]: e.target.value }));
              requestId.current = null;
            }}
          />
        </div>
      ))}
      {channel === "email" && !mailpit && (
        <label className="block text-xs font-medium">
          Port / TLS
          <select
            className="mt-2 min-h-11 w-full rounded-md border bg-white px-3 text-sm"
            disabled={busy || refreshing || conflict}
            value={config.port ?? "587"}
            onChange={(e) => {
              setConfig((c) => ({ ...c, port: e.target.value }));
              requestId.current = null;
            }}
          >
            <option value="587">587 · STARTTLS wajib</option>
            <option value="465">465 · TLS langsung</option>
          </select>
        </label>
      )}
      <p className="text-xs leading-6 text-muted-foreground">
        {channel === "email"
          ? "SMTP publik memakai TLS. Mode Mailpit hanya untuk pengujian lokal pada port 1025 tanpa password; periksa inbox di localhost:8025."
          : "Bot token terenkripsi dan tidak ditampilkan kembali. Chat ID adalah tujuan admin yang akan menerima informasi operasional."}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy || refreshing || conflict}>
          {busy ? "Memproses…" : "Simpan konfigurasi"}
        </Button>
        {value && (
          <Button
            type="button"
            variant="outline"
            disabled={busy || refreshing || conflict}
            onClick={() => {
              requestId.current = null;
              setConfirm(true);
            }}
          >
            Uji kanal
          </Button>
        )}
      </div>
      {confirm && (
        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-xs leading-6">
            Antrekan pesan uji ke tujuan yang sudah disimpan? Worker akan
            mengirim saat kanal aktif. Perubahan form yang belum disimpan tidak
            digunakan.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              disabled={busy || refreshing}
              onClick={() => void submit("test")}
            >
              Ya, antrekan pesan uji
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy || refreshing}
              onClick={() => setConfirm(false)}
            >
              Batal
            </Button>
          </div>
        </div>
      )}
      {message && (
        <p role="status" className="text-sm leading-7">
          {message}
        </p>
      )}
      {conflict && (
        <Button
          type="button"
          variant="outline"
          onClick={() => window.location.reload()}
        >
          Muat ulang konfigurasi
        </Button>
      )}
    </form>
  );
}
