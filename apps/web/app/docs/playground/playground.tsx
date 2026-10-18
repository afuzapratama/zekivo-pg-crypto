"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  FlaskConical,
  QrCode,
  Activity,
  ReceiptText,
  Radio,
} from "lucide-react";
import styles from "../docs.module.css";
import ui from "./playground.module.css";
type Invoice = {
  id: string;
  order_id: string;
  asset: string;
  status: string;
  amount: string;
  price_currency?: "USD";
  price_amount?: string;
  payable_amount: string;
  checkout_url: string;
  payment_enabled: boolean;
  invoice_version: number;
  recipient: string;
  mint: string;
  reference: string;
  expires_at: string;
};
type View = {
  invoice: Invoice;
  transfers: {
    signature: string;
    amount: string;
    disposition: string;
    created_at: string;
  }[];
  events: {
    event_id: string;
    event_type: string;
    payload: unknown;
    created_at: string;
  }[];
  receipts: {
    event_id: string;
    signature_verified: boolean;
    received_at: string;
  }[];
  actions: {
    request_id: string;
    mode: string;
    status: string;
    signature?: string;
  }[];
  deliveries: { id: string; status: string; attempt_count: number }[];
};
type Create = {
  request_id: string;
  order_id: string;
  price_currency: "USD";
  price_amount: string;
  payment_asset: string;
  network: "solana";
  expires_in_seconds: number;
  allowed_payment_assets?: string[];
};
const storageKey = "zekivo.local.playground.invoice";
export default function Playground() {
  const [ready, setReady] = useState(false),
    [asset, setAsset] = useState("USDC"),
    [amount, setAmount] = useState("25.83"),
    [both, setBoth] = useState(false),
    [order, setOrder] = useState(""),
    [expiry, setExpiry] = useState(900);
  const [invoiceId, setInvoiceId] = useState(""),
    [view, setView] = useState<View | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [connected, setConnected] = useState(false),
    [refresh, setRefresh] = useState(0),
    [last, setLast] = useState<Create | null>(null);
  const [runnerNotice, setRunnerNotice] = useState(
    "Menghubungkan ke runner lokal…",
  );
  const [createUncertain, setCreateUncertain] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function connect() {
      try {
        const response = await fetch("/api/playground/health", {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10000),
          ]),
        });
        if (controller.signal.aborted) return;
        setReady(response.ok);
        setRunnerNotice(
          response.ok
            ? "Runner lokal aktif. Siap membuat invoice dan menguji pembayaran mock."
            : response.status === 404
              ? "Playground pembayaran mock tersedia di localhost dengan mode localnet. Buka lingkungan lokal untuk menjalankan pengujian."
              : "Runner lokal sedang tidak tersedia. Koneksi akan dicoba kembali otomatis.",
        );
        await response.body?.cancel();
        if (response.ok || response.status === 404) return;
      } catch {
        if (controller.signal.aborted) return;
        setReady(false);
        setRunnerNotice(
          "Runner lokal belum dapat dihubungi. Mencoba kembali otomatis…",
        );
      }
      timer = setTimeout(() => void connect(), 5000);
    }
    void connect();
    try {
      const id = localStorage.getItem(storageKey);
      if (id && /^[a-f0-9-]{36}$/.test(id)) setInvoiceId(id);
    } catch {
      /* Storage is optional. */
    }
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (!invoiceId || !ready) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const r = await fetch(`/api/playground/invoices/${invoiceId}`, {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(20000),
          ]),
        });
        if (!r.ok) throw new Error();
        const data: View = await r.json();
        if (!active) return;
        setView(data);
        setConnected(true);
        if (data.invoice.status === "paid")
          setNotice((current) =>
            current.startsWith("Pengiriman mock dijadwalkan")
              ? "Pembayaran finalized. Periksa pengiriman webhook pada timeline."
              : current,
          );
      } catch {
        if (!active) return;
        setConnected(false);
        setNotice(
          "Status belum dapat dimuat. Jangan kirim ulang; halaman akan mencoba kembali.",
        );
      }
      if (active) timer = setTimeout(poll, 5000);
    }
    void poll();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [invoiceId, ready, refresh]);
  async function create(retry?: Create) {
    if (busy) return;
    setBusy(true);
    setNotice("");
    const data: Create = retry ?? {
      request_id: crypto.randomUUID(),
      order_id: order || crypto.randomUUID(),
      payment_asset: asset,
      price_currency: "USD",
      price_amount: amount,
      network: "solana",
      expires_in_seconds: expiry,
      ...(both
        ? {
            allowed_payment_assets: ["USDT", "USDC"],
          }
        : {}),
    };
    setLast(data);
    try {
      const r = await fetch("/api/playground/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(25000),
      });
      if (!r.ok) throw new Error();
      const result = await r.json();
      setCreateUncertain(false);
      setView(null);
      setConnected(false);
      setInvoiceId(result.invoice.id);
      setRefresh((v) => v + 1);
      setNotice(
        "Invoice dibuat. Status dan transaksi di bawah berasal dari layanan lokal.",
      );
      try {
        localStorage.setItem(storageKey, result.invoice.id);
      } catch {
        /* Storage is optional. */
      }
    } catch {
      setCreateUncertain(true);
      setNotice(
        "Invoice belum dapat dipastikan. Periksa input/konflik order atau ulang request yang sama dengan tombol di bawah.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function pay(mode: string) {
    if (!view || busy) return;
    const request_id = crypto.randomUUID();
    setBusy(true);
    setNotice("");
    setView({
      ...view,
      actions: [...view.actions, { request_id, mode, status: "pending" }],
    });
    try {
      const r = await fetch(`/api/playground/invoices/${view.invoice.id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id, mode }),
        signal: AbortSignal.timeout(25000),
      });
      if (!r.ok) throw new Error();
      setNotice(
        "Pengiriman mock dijadwalkan. Tunggu transaksi finalized dan watcher memperbarui invoice.",
      );
    } catch {
      setNotice(
        "Hasil pengiriman belum pasti. Periksa timeline; jangan mengirim ulang secara otomatis.",
      );
    } finally {
      setBusy(false);
      setRefresh((v) => v + 1);
    }
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("Teks disalin.");
    } catch {
      setNotice("Clipboard tidak tersedia. Pilih teks dan salin manual.");
    }
  }
  const invoice = view?.invoice;
  const canPay =
    ready &&
    connected &&
    !busy &&
    invoice?.status === "pending" &&
    invoice.payment_enabled &&
    view?.actions.length === 0 &&
    view.transfers.length === 0 &&
    Date.parse(invoice.expires_at) > Date.now();
  let checkout = "";
  try {
    if (invoice) {
      const path = new URL(invoice.checkout_url).pathname;
      if (/^\/pay\/[a-zA-Z0-9_-]{43}$/.test(path)) checkout = path;
    }
  } catch {
    /* Never navigate to arbitrary backend URLs. */
  }
  const sanitized = invoice
    ? { ...invoice, checkout_url: "[gunakan tombol Buka checkout]" }
    : null;
  return (
    <>
      <header className={ui.header}>
        <div>
          <Badge variant="outline" className={styles.badge}>
            <FlaskConical size={12} aria-hidden="true" /> LOCALNET · MOCK TOKEN
          </Badge>
          <h1>Payment playground</h1>
          <p>Uji satu alur pembayaran, dari invoice sampai webhook diterima.</p>
        </div>
        <div className={ui.environment}>
          <span className={ui.dot} data-ready={ready} />
          <span>
            {ready ? "Sandbox terhubung" : "Sandbox belum terhubung"}
            <small>Token lokal · tanpa dana asli</small>
          </span>
        </div>
      </header>
      <ol className={ui.journey} aria-label="Alur pengujian">
        {[
          ["Buat invoice", "Tentukan aset dan nominal", Boolean(invoice)],
          [
            "Uji pembayaran",
            "Buka checkout dan pilih skenario",
            Boolean(view?.transfers.length),
          ],
          [
            "Periksa webhook",
            "Lihat event dan verifikasi signature",
            Boolean(view?.receipts.some((r) => r.signature_verified)),
          ],
        ].map(([title, description, complete], index) => (
          <li key={String(title)} data-complete={Boolean(complete)}>
            <b>{complete ? "✓" : index + 1}</b>
            <span>
              {title}
              <small>{description}</small>
            </span>
          </li>
        ))}
      </ol>
      <div role="status" className={ui.notice} data-ready={ready}>
        <Radio size={16} aria-hidden="true" />
        <span>{notice || runnerNotice}</span>
      </div>
      <div className={ui.workspace}>
        <Card
          role="region"
          className={`${styles.card} ${ui.panel}`}
          aria-label="Generator invoice"
        >
          <h2 className="flex items-center gap-2">
            <ReceiptText
              size={17}
              className="text-primary"
              aria-hidden="true"
            />
            1. Generate invoice
          </h2>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <p className={ui.hint}>
              Masukkan harga asli dari Zekivo dalam USD. Gateway menghitung
              jumlah token dan kode unik pembayaran.
            </p>
            <Label>
              Aset awal
              <select
                aria-label="Aset awal"
                value={asset}
                onChange={(e) => setAsset(e.target.value)}
              >
                <option>USDC</option>
                <option>USDT</option>
              </select>
            </Label>
            <Label>
              Harga pesanan (USD)
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                pattern="(0|[1-9][0-9]{0,2})(\.[0-9]{2})"
                required
              />
            </Label>
            <Label className={styles.check}>
              <Input
                type="checkbox"
                checked={both}
                onChange={(e) => setBoth(e.target.checked)}
              />
              Izinkan pembayaran USDT dan USDC
            </Label>
            <details className={ui.advanced}>
              <summary>
                Pengaturan invoice <span>Order ID &amp; masa berlaku</span>
              </summary>
              <div className={ui.advancedFields}>
                {" "}
                <Label>
                  Order ID
                  <Input
                    value={order}
                    onChange={(e) => setOrder(e.target.value)}
                    placeholder="Kosongkan untuk UUID baru"
                    pattern="[a-zA-Z0-9_-]{1,80}"
                    maxLength={80}
                  />
                </Label>
                <Label>
                  Expiry (detik)
                  <Input
                    type="number"
                    value={expiry}
                    onChange={(e) => setExpiry(Number(e.target.value))}
                    min={60}
                    max={900}
                    required
                  />
                </Label>
              </div>
            </details>
            <Button className={styles.button} disabled={!ready || busy}>
              {busy ? "Memproses…" : "Generate invoice"}
            </Button>
            {last && createUncertain && (
              <Button
                type="button"
                className={`${styles.button} ${styles.secondary}`}
                disabled={!ready || busy}
                onClick={() => void create(last)}
              >
                Ulang request yang sama
              </Button>
            )}
          </form>
          <details className={ui.inspector}>
            <summary className={styles.summary}>
              Request / response tanpa kredensial
            </summary>
            <pre tabIndex={0}>
              {JSON.stringify({ request: last, response: sanitized }, null, 2)}
            </pre>
          </details>
        </Card>
        <Card
          role="region"
          className={`${styles.card} ${ui.panel}`}
          aria-label="Pembayaran dan status"
        >
          <h2 className="flex items-center gap-2">
            <QrCode size={17} className="text-primary" aria-hidden="true" />
            2. Checkout &amp; pengujian
          </h2>
          {!invoice ? (
            <div className={styles.empty}>
              <div>
                <QrCode size={36} className="mx-auto" aria-hidden="true" />
                <p className="mb-2 font-medium text-foreground">
                  Checkout siap setelah invoice dibuat
                </p>
                <p>
                  Pilih aset dan nominal di form, lalu klik Generate invoice.
                  Detail pembayaran dan skenario pengujian akan muncul di sini.
                </p>
              </div>
            </div>
          ) : (
            <>
              {invoice.price_currency === "USD" && (
                <div className={styles.stat}>
                  <span>Harga asli pesanan</span>
                  <strong>${invoice.price_amount} USD</strong>
                </div>
              )}
              <div className={ui.amount}>
                <span>Nominal token yang harus dibayar</span>
                <strong>
                  {invoice.payable_amount} <small>{invoice.asset}</small>
                </strong>
                <Badge variant="outline">{invoice.status}</Badge>
              </div>
              <div className={styles.stat}>
                <span>Invoice</span>
                <code>{invoice.id}</code>
              </div>

              <p>
                {connected
                  ? "Status terbaru tersambung."
                  : "Koneksi status terputus; data terakhir mungkin tertinggal."}
              </p>
              <div className={styles.actions}>
                {checkout && (
                  <a
                    className={styles.button}
                    href={checkout}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Buka checkout QR ↗
                  </a>
                )}
                <Button
                  className={`${styles.button} ${styles.secondary}`}
                  onClick={() => void copy(invoice.payable_amount)}
                >
                  Salin nominal
                </Button>
              </div>
              <div className={ui.scenarioHeading}>
                <h3>Skenario pembayaran</h3>
                <p>
                  Pilih satu skenario untuk setiap invoice. Runner mengirim
                  token mock pada validator lokal.
                </p>
              </div>
              <div className={ui.scenarios}>
                {[
                  ["exact", "Bayar tepat", "Nominal sesuai + reference"],
                  ["manual", "Transfer manual", "Pencocokan melalui nominal"],
                  ["partial", "Bayar kurang", "Kurang 0.000001 token"],
                  ["overpaid", "Bayar lebih", "Lebih 0.000001 token"],
                ].map(([mode, label, description]) => (
                  <Button
                    key={mode}
                    aria-label={label}
                    className={`${styles.button} ${styles.secondary}`}
                    disabled={!canPay}
                    onClick={() => void pay(mode!)}
                  >
                    <span>
                      {label}
                      <small>{description}</small>
                    </span>
                  </Button>
                ))}
              </div>
              <p>
                Kurang/lebih menggunakan selisih satu base unit (0.000001 token)
                dan reference invoice. Ini bukan refund atau pembayaran otomatis
                pada Devnet/Mainnet.
              </p>
              <details>
                <summary className={styles.summary}>
                  Alamat penerima / mint
                </summary>
                <pre tabIndex={0}>
                  {invoice.recipient + "\n" + invoice.mint}
                </pre>
                <Button
                  className={`${styles.button} ${styles.secondary}`}
                  onClick={() => void copy(invoice.recipient)}
                >
                  Salin alamat
                </Button>
              </details>
            </>
          )}
        </Card>
      </div>
      <section
        className={`${styles.block} ${ui.results}`}
        aria-label="Hasil pengujian"
      >
        <h2 className="flex items-center gap-2">
          <Activity size={17} className="text-primary" aria-hidden="true" />
          3. Timeline transaksi &amp; webhook
        </h2>
        <p>
          Ikuti hasil dari server. Pembayaran selesai setelah transaksi
          finalized dan status invoice diperbarui.
        </p>
        <div className={ui.resultSummary}>
          <div>
            <span>Transfer finalized</span>
            <strong>{view?.transfers.length ?? 0}</strong>
          </div>
          <div>
            <span>Event pembayaran</span>
            <strong>{view?.events.length ?? 0}</strong>
          </div>
          <div>
            <span>Signature webhook</span>
            <strong>
              {view?.receipts.some((r) => r.signature_verified)
                ? "Terverifikasi"
                : "Menunggu"}
            </strong>
          </div>
        </div>
        {!view ? (
          <div className={ui.resultEmpty}>
            Belum ada aktivitas. Buat invoice dan jalankan pembayaran untuk
            melihat hasilnya di sini.
          </div>
        ) : (
          <ul className={styles.timeline}>
            {view.actions.map((a) => (
              <li key={a.request_id}>
                Runner {a.mode}: <strong>{a.status}</strong>
                {a.status === "unknown" &&
                  " — hasil belum pasti; periksa chain sebelum tindakan lain."}
                {a.signature && <pre tabIndex={0}>{a.signature}</pre>}
              </li>
            ))}
            {view.transfers.map((t) => (
              <li key={t.signature + ":" + t.created_at}>
                Transfer finalized · {t.disposition} · {t.amount} base units
                <pre tabIndex={0}>{t.signature}</pre>
              </li>
            ))}
            {view.events.map((e) => (
              <li key={e.event_id}>
                {e.event_type}
                <details>
                  <summary className={styles.summary}>
                    Inspect payload {e.event_id}
                  </summary>
                  <pre tabIndex={0}>{JSON.stringify(e.payload, null, 2)}</pre>
                </details>
              </li>
            ))}
            {view.deliveries.map((d) => (
              <li key={d.id}>
                Webhook delivery {d.status} · {d.attempt_count} attempt
              </li>
            ))}
            {view.receipts.map((r) => (
              <li key={r.event_id}>
                Merchant inbox ·{" "}
                {r.signature_verified
                  ? "Signature verified"
                  : "Belum terverifikasi"}
              </li>
            ))}
            {view.transfers.length === 0 && view.events.length === 0 && (
              <li>
                Belum ada transfer finalized atau event pembayaran untuk invoice
                ini.
              </li>
            )}
          </ul>
        )}
      </section>
    </>
  );
}
