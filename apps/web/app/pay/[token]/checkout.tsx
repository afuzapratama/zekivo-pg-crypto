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
  Copy,
  Wallet,
} from "lucide-react";
import styles from "./checkout.module.css";

type Invoice = {
  price_currency?: "USD";
  price_amount?: string;
  description?: string;
  quote?: {
    rate_usd_per_token: string;
    converted_amount: string;
    source: string;
  };
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
      <div className={styles.frame}>
        <header className={styles.header}>
          <Brand />
          <span className={styles.network}>
            <ShieldCheck size={14} aria-hidden="true" /> Pembayaran aman
          </span>
        </header>
        <main className={styles.main}>
          <div className={styles.columns}>
            <aside className={styles.summary}>
              <h2>Ringkasan pembayaran</h2>
              <p className={styles.muted}>
                {invoice?.description || "Pembayaran melalui Zekivo"}
              </p>
              {invoice?.price_currency === "USD" && (
                <div className={styles.originalPrice}>
                  <span>Harga pesanan</span>
                  <strong>
                    ${invoice.price_amount} <small>USD</small>
                  </strong>
                </div>
              )}
              <details
                className={styles.breakdown}
                open={detailsOpen}
                onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
              >
                <summary>Rincian invoice</summary>
                <dl>
                  {invoice?.quote && (
                    <div>
                      <dt>Kurs saat invoice dibuat</dt>
                      <dd>
                        1 {invoice.asset} = ${invoice.quote.rate_usd_per_token}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Nominal dasar token</dt>
                    <dd>
                      {invoice?.amount ?? "—"} {invoice?.asset}
                    </dd>
                  </div>
                  <div>
                    <dt>Jaringan</dt>
                    <dd>Solana</dd>
                  </div>
                  <div>
                    <dt>Aset invoice</dt>
                    <dd>{invoice?.asset ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Status server</dt>
                    <dd>{invoice?.status ?? "—"}</dd>
                  </div>
                </dl>
                <p className={styles.hint}>
                  Nominal akhir memuat kode unik. Kirim seluruh digit sesuai
                  invoice.
                </p>
              </details>
              <div className={styles.summaryTotal}>
                <span>Total pembayaran</span>
                <strong>
                  {invoice?.payable_amount ?? "—"}{" "}
                  <small>{invoice?.asset}</small>
                </strong>
              </div>
              <div className={styles.summaryBottom}>
                <ShieldCheck size={16} aria-hidden="true" />
                <p>Status diperbarui otomatis setelah pembayaran diterima.</p>
              </div>
            </aside>
            <Card
              role="region"
              className={styles.card}
              aria-label="Instruksi pembayaran"
            >
              <div className={styles.cardHeading}>
                <span className={styles.tokenMark} aria-hidden="true">
                  {invoice?.asset === "USDT" ? (
                    <img src="/tokens/usdt.svg" width={32} height={32} alt="" />
                  ) : invoice?.asset === "USDC" ? (
                    <img src="/tokens/usdc.svg" width={32} height={32} alt="" />
                  ) : null}
                </span>
                <div>
                  <p className={styles.eyebrow}>
                    SOLANA · {invoice?.asset ?? "PAYMENT"}
                  </p>
                  <h1>{title}</h1>
                </div>
              </div>
              {invoice && ["localnet", "devnet"].includes(invoice.cluster) && (
                <Badge variant="outline" className={styles.badge}>
                  {invoice.cluster === "devnet" && invoice.asset === "USDT"
                    ? "DEVNET · MOCK USDT · TOKEN UJI"
                    : `${invoice.cluster.toUpperCase()} · DANA TEST`}
                </Badge>
              )}
              {canPay && invoice && (
                <div className={styles.paymentBody}>
                  <div className={styles.amount}>
                    <span>Total token yang harus dibayar</span>
                    <code>
                      {invoice.payable_amount} {invoice.asset}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void copy(invoice.payable_amount, "Nominal")
                      }
                    >
                      <Copy size={13} aria-hidden="true" />
                      Salin nominal
                    </Button>
                  </div>
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
                  <p className={styles.center}>Scan dengan wallet Solana Pay</p>
                  <div className={styles.address}>
                    <div className={styles.label}>
                      Alamat penerima <span>Solana (SPL)</span>
                    </div>
                    <div className={styles.addressValue}>
                      <code>{invoice.recipient}</code>
                      <Button
                        variant="secondary"
                        size="icon"
                        aria-label="Salin alamat"
                        onClick={() => void copy(invoice.recipient!, "Alamat")}
                      >
                        <Copy size={16} aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                  <div className={styles.safety}>
                    Hanya {invoice.asset} di jaringan Solana. Kirim nominal
                    persis.
                  </div>
                </div>
              )}
              {!canPay && invoice && (
                <div className={styles.amount}>
                  <span>Total pembayaran</span>
                  <code>
                    {invoice.payable_amount} {invoice.asset}
                  </code>
                </div>
              )}
              <div className={styles.status}>
                <span className={styles.dot} aria-hidden="true" />
                <span role="status" aria-live="polite">
                  {switching
                    ? "Memperbarui pilihan aset…"
                    : connection === "offline"
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
                                  : remaining === 0 ||
                                      invoice.status === "expired"
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
                  <Button asChild className={styles.primary}>
                    <a href={paymentUrl} onClick={() => setWalletHelp(true)}>
                      <Wallet size={16} aria-hidden="true" /> Buka wallet Solana
                      Pay <ArrowUpRight size={15} aria-hidden="true" />
                    </a>
                  </Button>
                  {walletHelp && (
                    <p className={styles.hint} role="status">
                      Wallet belum terbuka? Scan QR dari perangkat lain atau
                      salin alamat dan nominal untuk transfer manual. Jangan
                      kirim dua kali.
                    </p>
                  )}
                  <details className={styles.more}>
                    <summary>Periksa mint token</summary>
                    {invoice.cluster === "localnet" && (
                      <p className={styles.hint}>
                        Localnet memerlukan wallet yang terhubung ke validator
                        lokal. QR tidak mengubah jaringan wallet.
                      </p>
                    )}
                    {invoice.cluster === "devnet" &&
                      invoice.asset === "USDT" && (
                        <p className={styles.hint}>
                          Mock USDT adalah token uji, bukan USDT asli dari
                          Tether. Gunakan mint di bawah.
                        </p>
                      )}
                    <code className={styles.value}>{invoice.mint}</code>
                    <p className={styles.hint}>
                      Untuk transfer dari exchange, jumlah yang diterima harus
                      sesuai setelah biaya penarikan. Jangan membulatkan
                      nominal.
                    </p>
                  </details>
                  {canPay && (invoice.payment_options?.length ?? 0) > 1 && (
                    <details className={styles.more}>
                      <summary>Ganti aset pembayaran</summary>
                      <p className={styles.hint}>
                        Sudah mengirim? Jangan mengganti aset atau membayar
                        lagi. Pilihan sebelumnya tetap dipantau sampai invoice
                        berakhir.
                      </p>
                      {invoice.payment_options
                        ?.filter((option) => option.asset !== invoice.asset)
                        .map((option) => (
                          <Button
                            variant="secondary"
                            className={styles.assetButton}
                            key={option.asset}
                            onClick={() => void changeAsset(option.asset)}
                          >
                            Belum mengirim, gunakan {option.asset} ·{" "}
                            {option.amount}
                          </Button>
                        ))}
                    </details>
                  )}
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
                  {review && (
                    <ul>
                      {invoice.review_reasons.map((reason) => (
                        <li key={reason}>
                          {reasons[reason] ??
                            "Transfer membutuhkan pemeriksaan"}
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

              {notice && (
                <p className={styles.notice} role="status">
                  {notice}
                </p>
              )}
            </Card>
          </div>
        </main>
        <footer className={styles.footer}>
          <span>
            <ShieldCheck size={13} aria-hidden="true" /> zekivo pay · Solana
            payments
          </span>
          <span>Jangan bagikan link checkout ini.</span>
        </footer>
      </div>
    </div>
  );
}
