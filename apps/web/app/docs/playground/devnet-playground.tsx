"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import styles from "../docs.module.css";
import ui from "./playground.module.css";

type Invoice = {
  id: string;
  order_id: string;
  asset: string;
  cluster: string;
  status: string;
  price_currency: string;
  price_amount: string;
  payable_amount: string;
  checkout_url: string;
  expires_at: string;
  payment_enabled: boolean;
  quote?: { rate_usd_per_token: string };
};
type Delivery = {
  id: string;
  event_id: string;
  status: string;
  attempt_count: number;
};
type Attempt = { key: string; body: Record<string, unknown> };
export default function DevnetPlayground({ apiUrl }: { apiUrl: string }) {
  const [key, setKey] = useState("");
  const [activeKey, setActiveKey] = useState("");
  const [asset, setAsset] = useState("USDC");
  const [amount, setAmount] = useState("25.83");
  const [order, setOrder] = useState("");
  const [both, setBoth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [polling, setPolling] = useState(false);
  const [deliveryNotice, setDeliveryNotice] = useState("");
  const generation = useRef(0);
  const currentInvoiceId = useRef("");
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
    },
    [],
  );
  function disconnect() {
    generation.current++;
    controller.current?.abort();
    setKey("");
    setActiveKey("");
    setInvoice(null);
    currentInvoiceId.current = "";
    setDeliveries([]);
    setAttempt(null);
    setBusy(false);
    setNotice("");
    setDeliveryNotice("");
  }
  async function connect() {
    if (!key.trim() || busy) return;
    const version = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setNotice("");
    try {
      const r = await fetch(`${apiUrl}/v1/invoices?limit=1`, {
        headers: { Authorization: `Bearer ${key.trim()}` },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
      });
      await r.body?.cancel();
      if (version !== generation.current) return;
      if (!r.ok) {
        setNotice(
          r.status === 401
            ? "API key tidak valid, kedaluwarsa, atau sudah dicabut."
            : "API belum dapat dihubungi. Coba kembali.",
        );
        return;
      }
      setActiveKey(key.trim());
      setKey("");
      setNotice("Project terhubung ke staging Devnet.");
    } catch {
      if (version === generation.current)
        setNotice("Koneksi gagal. Periksa API key dan coba kembali.");
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (!activeKey || !invoice?.id) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const id = invoice.id;
    async function poll() {
      try {
        const options = {
          headers: { Authorization: `Bearer ${activeKey}` },
          cache: "no-store" as const,
          redirect: "error" as const,
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
        };
        const [a, b] = await Promise.all([
          fetch(`${apiUrl}/v1/invoices/${id}`, options),
          fetch(
            `${apiUrl}/v1/webhook-deliveries?invoice_id=${id}&limit=25`,
            options,
          ),
        ]);
        if (abort.signal.aborted) return;
        if (a.status === 401 || b.status === 401) {
          setPolling(false);
          setNotice(
            "Sesi API key tidak valid. Putuskan koneksi lalu masukkan key yang aktif.",
          );
          return;
        }
        if (!a.ok) throw new Error();
        const current: Invoice = await a.json();
        if (current.cluster !== "devnet") throw new Error();
        const result = b.ok ? await b.json() : null;
        if (abort.signal.aborted || currentInvoiceId.current !== id) return;
        setInvoice(current);
        setPolling(true);
        if (result) {
          setDeliveries(result.items);
          setDeliveryNotice("");
        } else setDeliveryNotice("Status delivery belum dapat dimuat.");
      } catch {
        if (!abort.signal.aborted) setPolling(false);
      }
      if (!abort.signal.aborted) timer = setTimeout(poll, 5000);
    }
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [apiUrl, activeKey, invoice?.id]);
  async function create() {
    if (!activeKey || busy) return;
    const version = generation.current;
    const request: Attempt = attempt ?? {
      key: crypto.randomUUID(),
      body: {
        order_id: order.trim() || `playground:${crypto.randomUUID()}`,
        price_currency: "USD",
        price_amount: amount,
        payment_asset: asset,
        network: "solana",
        expires_in_seconds: 900,
        ...(both ? { allowed_payment_assets: ["USDT", "USDC"] } : {}),
      },
    };
    setAttempt(request);
    setBusy(true);
    setNotice("");
    const abort = new AbortController();
    controller.current = abort;
    try {
      const r = await fetch(`${apiUrl}/v2/invoices`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${activeKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": request.key,
        },
        body: JSON.stringify(request.body),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]),
      });
      if (version !== generation.current) return;
      if (!r.ok) {
        await r.body?.cancel();
        if (r.status === 400) {
          setAttempt(null);
          setNotice(
            "Input tidak valid. Gunakan USD positif dengan dua desimal dan aset yang didukung.",
          );
        } else if (r.status === 401)
          setNotice("API key tidak valid. Hubungkan ulang dengan key aktif.");
        else if (r.status === 409)
          setNotice(
            "Request konflik. Periksa invoice pada dashboard sebelum mencoba request baru.",
          );
        else
          setNotice(
            "Hasil belum pasti atau pricing belum tersedia. Ulangi request yang sama; jangan membuat order ganda.",
          );
        return;
      }
      const result: Invoice = await r.json();
      if (version !== generation.current) return;
      if (
        result.cluster !== "devnet" ||
        new URL(result.checkout_url).origin !== location.origin
      )
        throw new Error();
      currentInvoiceId.current = result.id;
      setInvoice(result);
      setDeliveries([]);
      setAttempt(null);
      setPolling(false);
      setNotice(
        "Invoice Devnet dibuat. Buka checkout dan bayar dari wallet Devnet kamu.",
      );
    } catch {
      if (version === generation.current)
        setNotice(
          "Hasil request belum pasti. Ulangi request yang sama dengan idempotency key yang tetap.",
        );
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }
  const locked = busy || !!attempt;
  return (
    <>
      <div className={ui.header}>
        <div>
          <Badge variant="secondary">SOLANA DEVNET · STAGING</Badge>
          <h1>Payment playground</h1>
          <p>
            Buat invoice USD, bayar dari wallet Devnet, lalu periksa status dan
            delivery webhook.
          </p>
        </div>
        <div className={ui.environment}>
          <span className={ui.dot} data-ready={!!activeKey} />
          <div>
            {activeKey ? "Project terhubung" : "Hubungkan project"}
            <small>USDC test · Mock USDT · Tanpa dana asli</small>
          </div>
        </div>
      </div>
      <div className={ui.notice}>
        Token Devnet tidak memiliki nilai uang. Key hanya dipakai di memori
        halaman, tidak disimpan di browser. Tutup atau muat ulang halaman untuk
        menghapusnya. Pengiriman webhook eksternal staging masih menunggu
        aktivasi operator.
      </div>
      <Card className={styles.card}>
        <h2>Koneksi project</h2>
        {activeKey ? (
          <div className="flex flex-wrap items-center gap-4">
            <span>API key terhubung</span>
            <Button variant="outline" onClick={disconnect}>
              Putuskan koneksi
            </Button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void connect();
            }}
            className="grid gap-4"
          >
            <Label htmlFor="devnet-api-key">API key staging</Label>
            <Input
              id="devnet-api-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Masukkan API key project"
              disabled={busy}
            />
            <div className="flex flex-wrap items-center gap-4">
              <Button disabled={!key.trim() || busy}>
                {busy ? "Menghubungkan…" : "Hubungkan project"}
              </Button>
              <Link href="/dashboard/projects">
                Kelola project &amp; API key
              </Link>
            </div>
          </form>
        )}
      </Card>
      <p role="status" aria-live="polite" className="my-5 text-sm">
        {notice}
      </p>
      <div className={ui.workspace}>
        <Card className={styles.card}>
          <h2>1. Generate invoice</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
            className="grid gap-5"
          >
            <div className="grid gap-2">
              <Label htmlFor="devnet-amount">Harga pesanan (USD)</Label>
              <Input
                id="devnet-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                pattern="(0|[1-9][0-9]{0,9})\.[0-9]{2}"
                required
                disabled={locked}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="devnet-asset">Aset awal</Label>
              <select
                className="h-11 rounded-md border bg-background px-3 text-sm"
                id="devnet-asset"
                value={asset}
                onChange={(e) => setAsset(e.target.value)}
                disabled={locked}
              >
                <option value="USDC">USDC Devnet</option>
                <option value="USDT">Mock USDT Devnet</option>
              </select>
            </div>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={both}
                onChange={(e) => setBoth(e.target.checked)}
                disabled={locked}
              />
              Izinkan pembayaran USDT dan USDC
            </label>
            <div className="grid gap-2">
              <Label htmlFor="devnet-order">Order ID (opsional)</Label>
              <Input
                id="devnet-order"
                value={order}
                onChange={(e) => setOrder(e.target.value)}
                maxLength={128}
                placeholder="Dibuat otomatis jika kosong"
                disabled={locked}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Masa berlaku 15 menit. Kurs dan kode unik dihitung oleh gateway.
            </p>
            <Button disabled={!activeKey || busy}>
              {busy
                ? "Memproses…"
                : attempt
                  ? "Ulang request yang sama"
                  : "Generate invoice"}
            </Button>
          </form>
        </Card>
        <Card className={styles.card}>
          <h2>2. Checkout &amp; status</h2>
          {invoice ? (
            <>
              <div className={ui.amount}>
                <span>Harga pesanan</span>
                <strong>${invoice.price_amount} USD</strong>
                <p className="mt-3 text-sm">
                  Kirim tepat {invoice.payable_amount} {invoice.asset}
                </p>
              </div>
              <p className="break-all text-sm">Order: {invoice.order_id}</p>
              <p role="status" className="text-sm">
                Status invoice: <strong>{invoice.status}</strong> ·{" "}
                {polling ? "Diperbarui otomatis" : "Menghubungkan ulang…"}
              </p>
              {invoice.payment_enabled && (
                <Button asChild>
                  <a
                    href={invoice.checkout_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Buka checkout Devnet
                  </a>
                </Button>
              )}
              <p className="text-xs leading-6 text-muted-foreground">
                Gunakan Phantom pada jaringan Devnet dan kirim dari wallet
                sendiri. Tidak ada tombol pengiriman otomatis atau akses private
                key.
              </p>
              <h3 className="mt-4 font-semibold">3. Delivery webhook</h3>
              {deliveryNotice && (
                <p role="status" className="text-sm">
                  {deliveryNotice}
                </p>
              )}
              {deliveries.length ? (
                <ul className="grid gap-3">
                  {deliveries.map((d) => (
                    <li
                      key={d.id}
                      className="break-all rounded-md border p-3 text-sm"
                    >
                      {d.status} · {d.attempt_count} percobaan
                      <br />
                      <small>Event: {d.event_id}</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm leading-6 text-muted-foreground">
                  Belum ada delivery. Daftarkan receiver HTTPS sebelum
                  pembayaran dan minta operator mengaktifkan pengiriman webhook
                  staging. Status paid tetap diperbarui walau delivery belum
                  aktif.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Status delivered berarti endpoint membalas 2xx; verifikasi
                signature dan fulfillment harus dibuktikan di receiver Zekivo.
              </p>
            </>
          ) : (
            <p className={ui.resultEmpty}>
              Hubungkan API key project, lalu buat invoice. Checkout dan status
              pembayaran akan tampil di sini.
            </p>
          )}
        </Card>
      </div>
    </>
  );
}
