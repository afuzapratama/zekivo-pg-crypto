"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brand } from "@/components/brand";
import {
  ShieldCheck,
  Check,
  Clock3,
  CircleAlert,
  ArrowUpRight,
} from "lucide-react";
import styles from "./checkout.module.css";

type Invoice = {
  invoice_version?: number;
  payment_options?: { asset: "USDT" | "USDC"; amount: string }[];
  asset: "USDT" | "USDC";
  cluster: string;
  status: "pending" | "confirming" | "paid" | "expired";
  amount: string;
  payable_amount: string;
  expires_at: string;
  server_time: string;
  payment_enabled: boolean;
  recipient: string | null;
  mint: string | null;
  reference: string | null;
  review_reasons: string[];
};
const reasons: Record<string, string> = {
  partial: "Jumlah pembayaran kurang",
  overpaid: "Jumlah pembayaran berlebih",
  late: "Pembayaran melewati batas waktu",
  duplicate_payment: "Pembayaran tambahan terdeteksi",
  reference_conflict: "Referensi pembayaran perlu diperiksa",
  predates_invoice: "Waktu pembayaran perlu diperiksa",
  inactive_attempt:
    "Pembayaran pada pilihan yang belum diaktifkan perlu diperiksa",
};
export default function Checkout({ token }: { token: string }) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [connection, setConnection] = useState("loading");
  const [remaining, setRemaining] = useState(0);
  const [deadline, setDeadline] = useState(0);
  const [qr, setQr] = useState("");
  const [qrFailed, setQrFailed] = useState(false);
  const [notice, setNotice] = useState("");
  const [walletHelp, setWalletHelp] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const latestVersion = useRef(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 681px)");
    const sync = () => setDetailsOpen(desktop.matches);
    sync();
    desktop.addEventListener("change", sync);
    return () => desktop.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    let request: AbortController | undefined;
    async function poll() {
      clearTimeout(timer);
      request?.abort();
      const current = new AbortController();
      request = current;
      const started = performance.now();
      try {
        const response = await fetch("/api/checkout", {
          headers: { "x-checkout-token": token },
          cache: "no-store",
          signal: AbortSignal.any([current.signal, AbortSignal.timeout(10000)]),
        });
        if (!active || request !== current) return;
        if (response.status === 404) {
          setInvoice(null);
          setConnection("missing");
          return;
        }
        if (!response.ok) throw new Error("unavailable");
        const data: Invoice = await response.json();
        if (!active || request !== current) return;
        if ((data.invoice_version ?? 0) < latestVersion.current) return;
        latestVersion.current = data.invoice_version ?? 0;
        setInvoice(data);
        // Use a monotonic clock; conservatively subtract the entire request duration.
        const left = Math.max(
          0,
          Date.parse(data.expires_at) -
            Date.parse(data.server_time) -
            (performance.now() - started),
        );
        setDeadline(performance.now() + left);
        setRemaining(Math.ceil(left / 1000));
        setConnection("connected");
        failures = 0;
        timer = setTimeout(poll, data.status === "paid" ? 15000 : 3000);
      } catch {
        if (!active || request !== current) return;
        setConnection("offline");
        timer = setTimeout(
          poll,
          Math.min(30000, 3000 * 2 ** Math.min(failures++, 4)),
        );
      }
    }
    function offline() {
      clearTimeout(timer);
      request?.abort();
      request = undefined;
      setConnection("offline");
    }
    function refresh() {
      setConnection("loading");
      void poll();
    }
    function visible() {
      if (document.visibilityState === "visible") refresh();
    }
    window.addEventListener("offline", offline);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", visible);
    if (navigator.onLine) void poll();
    else offline();
    return () => {
      active = false;
      request?.abort();
      clearTimeout(timer);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [token, refreshKey]);
  useEffect(() => {
    const timer = setInterval(
      () =>
        setRemaining(
          Math.max(0, Math.ceil((deadline - performance.now()) / 1000)),
        ),
      1000,
    );
    return () => clearInterval(timer);
  }, [deadline]);
  const review = Boolean(invoice?.review_reasons.length);
  const canPay = Boolean(
    invoice?.payment_enabled &&
    invoice.status === "pending" &&
    remaining > 0 &&
    !review &&
    !switching &&
    connection === "connected",
  );
  const paymentUrl =
    invoice?.recipient && invoice.mint && invoice.reference
      ? `solana:${invoice.recipient}?${new URLSearchParams({ amount: invoice.payable_amount, "spl-token": invoice.mint, reference: invoice.reference, label: "Zekivo" })}`
      : "";
  useEffect(() => {
    let active = true;
    setQr("");
    setQrFailed(false);
    if (canPay && paymentUrl)
      void QRCode.toDataURL(paymentUrl, {
        width: 288,
        margin: 3,
        errorCorrectionLevel: "M",
      })
        .then((value) => {
          if (active) setQr(value);
        })
        .catch(() => {
          if (active) {
            setQrFailed(true);
            setNotice("QR belum tersedia. Gunakan salin alamat dan nominal.");
          }
        });
    return () => {
      active = false;
    };
  }, [paymentUrl, canPay]);
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} disalin.`);
    } catch {
      setNotice(
        `Tidak dapat menyalin ${label.toLowerCase()}. Pilih teks lalu salin secara manual.`,
      );
    }
  }
  async function changeAsset(asset: string) {
    if (!invoice?.invoice_version || switching) return;
    setSwitching(true);
    setNotice("");
    try {
      const response = await fetch("/api/checkout/asset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-checkout-token": token,
        },
        body: JSON.stringify({
          asset,
          expected_version: invoice.invoice_version,
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok)
        throw new Error(response.status === 409 ? "changed" : "unavailable");
      const result = await response.json();
      latestVersion.current = Math.max(
        latestVersion.current,
        result.invoice_version,
      );
      setNotice("Pilihan aset diperbarui. Memuat rincian pembayaran terbaru.");
    } catch (error) {
      setNotice(
        error instanceof Error && error.message === "changed"
          ? "Invoice sudah berubah atau pilihan aset ditutup. Status terbaru sedang dimuat."
          : "Pilihan aset belum dapat dipastikan. Status terbaru sedang dimuat; jangan mengirim sebelum rincian muncul.",
      );
    } finally {
      setConnection("loading");
      setRefreshKey((key) => key + 1);
      setSwitching(false);
    }
  }
  const title =
    connection === "missing"
      ? "Link tidak ditemukan"
      : !invoice
        ? connection === "offline"
          ? "Belum dapat terhubung"
          : "Memuat pembayaran"
        : invoice.status === "paid"
          ? "Pembayaran diterima"
          : review
            ? "Pembayaran perlu diperiksa"
            : connection !== "connected"
              ? "Memperbarui status pembayaran"
              : !invoice.payment_enabled
                ? "Pembayaran belum tersedia"
                : invoice.status === "expired" || remaining === 0
                  ? "Waktu pembayaran berakhir"
                  : invoice.status === "confirming"
                    ? "Menunggu konfirmasi"
                    : "Selesaikan pembayaran";
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Brand />
        <span className={styles.network}>
          SOLANA <i /> {invoice?.cluster ?? "Sandbox"}
        </span>
      </header>
      <main className={styles.main}>
        <div className={styles.context}>
          <Badge variant="outline" className={styles.badge}>
            {invoice?.cluster === "devnet" && invoice.asset === "USDT"
              ? "DEVNET · MOCK USDT · TOKEN UJI"
              : "SANDBOX · DANA TEST"}
          </Badge>
          <p>Pembayaran melalui Zekivo</p>
          <h1>{title}</h1>
          <p>
            {invoice?.status === "paid"
              ? "Transfer telah diverifikasi finalized. Merchant akan memproses pesanan melalui sistemnya."
              : "Status pembayaran diverifikasi otomatis dari jaringan Solana."}
          </p>
        </div>
        {invoice?.cluster === "devnet" && invoice.asset === "USDT" && (
          <p className="mb-6 text-sm text-muted-foreground">
            Gunakan mint Mock USDT yang tercantum di checkout. Token ini khusus
            pengujian, bukan USDT asli dari Tether.
          </p>
        )}
        <div className={styles.columns}>
          <aside className={styles.summary}>
            <span className={styles.caption}>RINCIAN PEMBAYARAN</span>
            <h2>
              {invoice ? invoice.payable_amount : "—"}{" "}
              <span>
                {invoice?.cluster === "devnet" && invoice.asset === "USDT"
                  ? "Mock USDT"
                  : invoice?.asset}
              </span>
            </h2>
            <details
              className={styles.breakdown}
              open={detailsOpen}
              onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
            >
              <summary>Rincian invoice</summary>
              <dl>
                <div>
                  <dt>Jaringan</dt>
                  <dd>Solana</dd>
                </div>
                <div>
                  <dt>Aset invoice</dt>
                  <dd>{invoice?.asset ?? "—"}</dd>
                </div>
                <div>
                  <dt>Nominal dasar</dt>
                  <dd>{invoice?.amount ?? "—"}</dd>
                </div>
                <div>
                  <dt>Status server</dt>
                  <dd>{invoice?.status ?? "—"}</dd>
                </div>
              </dl>
              <p className={styles.hint}>
                Nominal akhir memuat tambahan kecil untuk identifikasi
                pembayaran. Kirim seluruh digit sesuai invoice.
              </p>
            </details>
            {canPay && (invoice?.payment_options?.length ?? 0) > 1 && (
              <details className={styles.breakdown}>
                <summary>Ganti aset pembayaran</summary>
                <p className={styles.hint}>
                  Sudah mengirim transfer? Jangan mengganti aset atau membayar
                  lagi. Pilihan sebelumnya tetap dipantau sampai batas waktu
                  invoice yang sama.
                </p>
                {invoice?.payment_options
                  ?.filter((option) => option.asset !== invoice.asset)
                  .map((option) => (
                    <Button
                      className={styles.assetButton}
                      key={option.asset}
                      onClick={() => void changeAsset(option.asset)}
                    >
                      Belum mengirim, gunakan {option.asset} · {option.amount}
                    </Button>
                  ))}
              </details>
            )}
            {switching && (
              <p role="status" className={styles.hint}>
                Memperbarui pilihan aset…
              </p>
            )}
            <div className={styles.safety}>
              Gunakan {invoice?.asset ?? "token yang dipilih"} di jaringan
              Solana. Token atau jaringan lain tidak melunasi invoice ini.
            </div>
          </aside>
          <Card
            role="region"
            className={styles.card}
            aria-label="Instruksi pembayaran"
          >
            <div className={styles.status}>
              <span className={styles.dot} aria-hidden="true" />
              <span role="status" aria-live="polite">
                {connection === "offline"
                  ? "Koneksi terputus · mencoba kembali otomatis"
                  : connection === "missing"
                    ? "Periksa kembali link checkout dari merchant."
                    : connection === "loading"
                      ? "Menghubungkan ke server…"
                      : invoice?.status === "paid"
                        ? "Terverifikasi · finalized"
                        : review
                          ? "Menunggu pemeriksaan operator"
                          : invoice?.status === "confirming"
                            ? "Menunggu konfirmasi jaringan"
                            : !invoice?.payment_enabled
                              ? "Penerimaan pembayaran belum aktif"
                              : remaining === 0 || invoice.status === "expired"
                                ? "Jangan kirim pembayaran baru"
                                : "Menunggu pembayaran"}
              </span>
              {canPay && (
                <span
                  role="timer"
                  aria-live="off"
                  aria-label="Sisa waktu pembayaran"
                >
                  {Math.floor(remaining / 60)
                    .toString()
                    .padStart(2, "0")}
                  :{(remaining % 60).toString().padStart(2, "0")}
                </span>
              )}
            </div>
            {canPay && invoice && (
              <>
                <div className={styles.qr}>
                  {qr ? (
                    <img
                      src={qr}
                      width={240}
                      height={240}
                      alt="QR pembayaran Solana Pay dengan nominal dan referensi invoice"
                    />
                  ) : (
                    <p>
                      {qrFailed
                        ? "Gunakan link wallet atau transfer manual."
                        : "Menyiapkan QR…"}
                    </p>
                  )}
                </div>
                <p className={styles.center}>
                  Scan memakai wallet yang mendukung Solana Pay.
                </p>
                {invoice.cluster === "localnet" && (
                  <p className={styles.local}>
                    Localnet memerlukan wallet yang terhubung ke validator
                    lokal. Wallet biasa tidak otomatis berpindah jaringan
                    melalui QR.
                  </p>
                )}
                <Button asChild className={styles.primary}>
                  <a href={paymentUrl} onClick={() => setWalletHelp(true)}>
                    Buka wallet Solana Pay{" "}
                    <ArrowUpRight size={16} aria-hidden="true" />
                  </a>
                </Button>
                {walletHelp && (
                  <p className={styles.local} role="status">
                    Wallet belum terbuka? Buka wallet yang mendukung Solana Pay,
                    scan QR dari perangkat lain, atau gunakan transfer manual di
                    bawah. Pastikan jaringan wallet sesuai; jangan kirim dua
                    kali.
                  </p>
                )}
                <div className={styles.divider}>
                  atau transfer manual / exchange
                </div>
                <div className={styles.label}>
                  Nominal persis{" "}
                  <Button
                    onClick={() => void copy(invoice.payable_amount, "Nominal")}
                  >
                    Salin nominal
                  </Button>
                </div>
                <code className={styles.value}>
                  {invoice.payable_amount} {invoice.asset}
                </code>
                <div className={styles.label}>
                  Alamat penerima{" "}
                  <Button
                    onClick={() => void copy(invoice.recipient!, "Alamat")}
                  >
                    Salin alamat
                  </Button>
                </div>
                <code className={styles.value}>{invoice.recipient}</code>
                <details>
                  <summary>Periksa mint token</summary>
                  <code className={styles.value}>{invoice.mint}</code>
                </details>
                <p className={styles.hint}>
                  Pastikan jumlah yang diterima persis setelah biaya penarikan
                  exchange. Jangan membulatkan nominal atau mengirim ulang saat
                  transfer sedang diproses.
                </p>
              </>
            )}
            {!invoice && (
              <div className={styles.result}>
                <div className={styles.symbol}>
                  <Clock3 size={28} aria-hidden="true" />
                </div>
                <h2>
                  {connection === "missing"
                    ? "Link tidak tersedia"
                    : connection === "offline"
                      ? "Server belum dapat dihubungi"
                      : "Menyiapkan checkout"}
                </h2>
                <p>
                  {connection === "missing"
                    ? "Minta link checkout yang benar dari merchant."
                    : connection === "offline"
                      ? "Periksa koneksi internet. Halaman akan mencoba kembali secara otomatis."
                      : "Mohon tunggu, rincian pembayaran sedang dimuat."}
                </p>
              </div>
            )}
            {!canPay && invoice && (
              <div className={styles.result}>
                <div className={styles.symbol}>
                  {invoice.status === "paid" ? (
                    <Check size={30} aria-hidden="true" />
                  ) : review ? (
                    <CircleAlert size={28} aria-hidden="true" />
                  ) : (
                    <Clock3 size={28} aria-hidden="true" />
                  )}
                </div>
                <h2>{title}</h2>
                {review && (
                  <ul>
                    {invoice.review_reasons.map((reason) => (
                      <li key={reason}>
                        {reasons[reason] ?? "Transfer membutuhkan pemeriksaan"}
                      </li>
                    ))}
                  </ul>
                )}
                <p>
                  {invoice.status === "paid"
                    ? "Kamu dapat kembali ke halaman pesanan merchant untuk melihat proses berikutnya."
                    : connection !== "connected"
                      ? "Instruksi pembayaran akan tersedia kembali setelah status terbaru berhasil dimuat."
                      : !invoice.payment_enabled
                        ? "Invoice ini belum diaktifkan untuk menerima transfer."
                        : "Jika sudah mengirim, simpan bukti transaksi dan hubungi merchant. Halaman ini tetap memeriksa status; jangan melakukan pembayaran kedua."}
                </p>
              </div>
            )}
            <p className={styles.notice} role="status">
              {notice}
            </p>
          </Card>
        </div>
        <footer className={styles.footer}>
          <span className="flex items-center gap-2">
            <ShieldCheck size={14} aria-hidden="true" />
            zekivo pay · Solana payments
          </span>
          <span>Jangan bagikan link checkout ini.</span>
        </footer>
      </main>
    </div>
  );
}
