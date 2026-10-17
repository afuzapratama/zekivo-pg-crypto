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
type Invoice = {
  id: string;
  order_id: string;
  asset: string;
  status: string;
  amount: string;
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
  asset: string;
  amount: string;
  expires_in_seconds: number;
  payment_options?: { asset: string; amount: string }[];
};
const storageKey = "zekivo.local.playground.invoice";
export default function Playground() {
  const [ready, setReady] = useState(false),
    [asset, setAsset] = useState("USDC"),
    [amount, setAmount] = useState("25"),
    [other, setOther] = useState("25"),
    [both, setBoth] = useState(false),
    [order, setOrder] = useState(""),
    [expiry, setExpiry] = useState(1800);
  const [invoiceId, setInvoiceId] = useState(""),
    [view, setView] = useState<View | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [connected, setConnected] = useState(false),
    [refresh, setRefresh] = useState(0),
    [last, setLast] = useState<Create | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/playground/health", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((r) => {
        setReady(r.ok);
        if (!r.ok)
          setNotice(
            "Playground lokal belum aktif. Jalankan Compose terbaru; fitur ini tidak tersedia pada Devnet/Mainnet atau hosting publik.",
          );
      })
      .catch(() => setNotice("Runner lokal belum dapat dihubungi."));
    try {
      const id = localStorage.getItem(storageKey);
      if (id && /^[a-f0-9-]{36}$/.test(id)) setInvoiceId(id);
    } catch {
      /* Storage is optional. */
    }
    return () => controller.abort();
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
      asset,
      amount,
      expires_in_seconds: expiry,
      ...(both
        ? {
            payment_options: [
              { asset, amount },
              { asset: asset === "USDC" ? "USDT" : "USDC", amount: other },
            ],
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
      <Badge variant="outline" className={styles.badge}>
        <FlaskConical size={12} aria-hidden="true" /> LOCALNET · MOCK TOKEN ·
        BUKAN DANA ASLI
      </Badge>
      <h1>
        Payment playground
        <span className="ml-3 align-middle text-xs font-normal tracking-normal text-muted-foreground">
          / sandbox
        </span>
      </h1>
      <p>
        Buat invoice, buka QR checkout, kirim token test dan telusuri webhook.
        Transaksi benar-benar berjalan pada validator lokal; status paid tidak
        disimulasikan.
      </p>
      <p role="status" className={styles.notice}>
        <Radio size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          {notice ||
            (!ready
              ? "Menghubungkan ke runner lokal…"
              : "Runner lokal aktif. Kredensial merchant disimpan di server.")}
        </span>
      </p>
      <div className={styles.steps} aria-label="Alur pengujian">
        <span>
          <b>1</b>Generate invoice
        </span>
        <span>→</span>
        <span>
          <b>2</b>Bayar mock token
        </span>
        <span>→</span>
        <span>
          <b>3</b>Verifikasi webhook
        </span>
      </div>
      <div className={styles.columns}>
        <Card
          role="region"
          className={styles.card}
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
            <Label>
              Project sandbox
              <Input value="Local sandbox · localnet" readOnly />
            </Label>
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
              Nominal dasar
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                pattern="(0|[1-9][0-9]{0,2})(\.[0-9]{1,6})?"
                required
              />
            </Label>
            <Label>
              Expiry (detik)
              <Input
                type="number"
                value={expiry}
                onChange={(e) => setExpiry(Number(e.target.value))}
                min={60}
                max={3600}
                required
              />
            </Label>
            <Label className={styles.check}>
              <Input
                type="checkbox"
                checked={both}
                onChange={(e) => setBoth(e.target.checked)}
              />
              Sediakan quote untuk kedua aset
            </Label>
            {both && (
              <Label>
                Quote {asset === "USDC" ? "USDT" : "USDC"}
                <Input
                  value={other}
                  onChange={(e) => setOther(e.target.value)}
                  inputMode="decimal"
                  pattern="(0|[1-9][0-9]{0,2})(\.[0-9]{1,6})?"
                  required
                />
              </Label>
            )}
            <Button className={styles.button} disabled={!ready || busy}>
              Generate invoice
            </Button>
            {last && (
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
          <details>
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
          className={styles.card}
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
                  Belum ada invoice
                </p>
                <p>
                  Invoice yang dibuat akan muncul di sini. Halaman dapat
                  di-refresh untuk memuat kembali invoice lokal terakhir.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className={styles.stat}>
                <span>Invoice</span>
                <code>{invoice.id}</code>
              </div>
              <div className={styles.stat}>
                <span>Status server</span>
                <strong>{invoice.status}</strong>
              </div>
              <div className={styles.stat}>
                <span>Nominal persis</span>
                <strong>
                  {invoice.payable_amount} {invoice.asset}
                </strong>
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
              <p>
                Gunakan satu skenario per invoice. Tombol mengirim mock token
                dari wallet fixture lokal dan menunggu finalized; siapkan
                invoice baru untuk skenario berikutnya.
              </p>
              <div className={styles.actions}>
                {[
                  ["exact", "Bayar tepat"],
                  ["manual", "Transfer manual"],
                  ["partial", "Bayar kurang"],
                  ["overpaid", "Bayar lebih"],
                ].map(([mode, label]) => (
                  <Button
                    key={mode}
                    className={`${styles.button} ${styles.secondary}`}
                    disabled={!canPay}
                    onClick={() => void pay(mode!)}
                  >
                    {label}
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
      {view && (
        <section className={styles.block}>
          <h2 className="flex items-center gap-2">
            <Activity size={17} className="text-primary" aria-hidden="true" />
            3. Timeline transaksi &amp; webhook
          </h2>
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
        </section>
      )}
    </>
  );
}
