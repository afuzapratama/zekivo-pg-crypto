import styles from "./docs.module.css";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowUpRight, Code2 } from "lucide-react";
export default function Docs() {
  return (
    <>
      <Badge variant="outline" className={styles.badge}>
        DOCUMENTATION · V0.1
      </Badge>
      <h1>Mulai integrasi pembayaran.</h1>
      <p>
        Invoice, checkout dan webhook untuk website Zekivo. Mulai dengan mock
        token pada validator lokal tanpa dana asli.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button asChild className="min-h-11">
          <a href="/docs/playground">
            Buka playground lokal <ArrowUpRight aria-hidden="true" />
          </a>
        </Button>
        <Button asChild variant="outline" className="min-h-11">
          <a href="/docs/api">
            API reference <Code2 aria-hidden="true" />
          </a>
        </Button>
      </div>
      <section className={styles.block}>
        <h2>1. Buat invoice dari backend</h2>
        <p>
          API key merchant disimpan pada backend. Idempotency-Key yang sama
          dengan payload sama mengembalikan invoice yang sama. Order ID unik per
          project.
        </p>
        <pre tabIndex={0}>{`curl http://localhost:4100/v1/invoices \\
  -H 'Authorization: Bearer <MERCHANT_API_KEY>' \\
  -H 'Idempotency-Key: order-001' \\
  -H 'Content-Type: application/json' \\
  -d '{"order_id":"order-001","asset":"USDC","amount":"25"}'`}</pre>
        <p>
          Untuk dua pilihan token, tambahkan payment_options berisi quote
          asset/amount USDT dan USDC yang dihitung backend merchant. Gateway
          tidak menghitung kurs. Checkout memakai checkout_url dari response.
        </p>
      </section>
      <section className={styles.block}>
        <h2>2. Kirim nominal persis, tunggu finalized</h2>
        <p>
          Semua amount adalah string desimal enam digit; penghitungan memakai
          base units. Tambahan nominal mengidentifikasi transfer manual. Solana
          Pay menyertakan reference; reference tetap memerlukan token, penerima,
          jumlah, keberhasilan transaksi dan finality yang benar.
        </p>
        <p>
          Checkout memperbarui status dari server. Transfer
          kurang/lebih/terlambat masuk review; pembayaran parsial tidak otomatis
          digabung. Dua aset pada satu order hanya boleh menghasilkan satu
          fulfillment.
        </p>
      </section>
      <section id="webhooks" className={styles.block}>
        <h2>3. Terima webhook di backend merchant</h2>
        <p>
          Event otomatis: payment.confirmed, payment.expired, payment.partial,
          payment.overpaid, payment.late dan payment.review_required. Hanya
          payment.confirmed finalized menjadi dasar fulfillment. Verifikasi
          HMAC-SHA256 terhadap timestamp + titik + raw body, toleransi waktu 300
          detik, lalu simpan event_id dan fulfillment atomik sebelum membalas
          2xx.
        </p>
        <pre
          tabIndex={0}
        >{`import { createHmac, timingSafeEqual } from "node:crypto";
// rawBody harus byte asli request. Secret berasal dari konfigurasi backend.
const expected = createHmac("sha256", secret)
  .update(timestamp + ".").update(rawBody).digest();
const received = Buffer.from(signature, "hex");
const valid = /^[a-f0-9]{64}$/i.test(signature)
  && received.length === expected.length
  && timingSafeEqual(received, expected);
// Selain signature: cek freshness, project, schema, finality,
// dedup event_id dan invoice_version sebelum commit fulfillment.`}</pre>
        <p>
          Header: Zekivo-Timestamp, Zekivo-Signature, Zekivo-Event-Id.
          Retry/replay memakai event_id tetap; urutan tidak dijamin. Timeout
          merchant 10 detik, retry sampai 24 jam per cycle, lalu dead-letter.
          Paid tidak bergantung pada keberhasilan delivery.
        </p>
      </section>
      <section className={styles.block}>
        <h2>Error dan pemulihan</h2>
        <table>
          <thead>
            <tr>
              <th>Kode</th>
              <th>Tindakan</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["400", "Perbaiki input atau precision."],
              ["401 / 404", "Periksa kredensial dan scope project."],
              [
                "409",
                "Periksa konflik order/idempotency/versi; ambil status terbaru.",
              ],
              [
                "429 / 503",
                "Tunggu dan coba lagi dengan backoff; jangan membuat pembayaran ganda.",
              ],
            ].map(([code, description]) => (
              <tr key={code}>
                <td>{code}</td>
                <td>{description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section id="devnet" className={styles.block}>
        <h2>Berikutnya: Devnet</h2>
        <p>
          Siapkan wallet pembayar dan penerima khusus test, SOL Devnet, USDC
          test Circle, serta mock USDT berlabel jelas. Gunakan database/API
          key/secret terpisah. Gateway hanya menerima alamat publik;
          penandatanganan dilakukan wallet pembayar.
        </p>
        <p>
          <a href="https://faucet.solana.com/">Faucet SOL</a> ·{" "}
          <a href="https://faucet.circle.com/">Faucet USDC</a> ·{" "}
          <a href="https://developers.circle.com/stablecoins/usdc-contract-addresses">
            Mint resmi Circle
          </a>
        </p>
        <p>
          Mint USDC Solana Devnet:{" "}
          <code>4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU</code>. Verifikasi
          lagi sebelum konfigurasi. Devnet berbeda dari Testnet untuk validator.
          Helper localnet tidak digunakan pada Devnet. Akun USDC penerima sudah
          dibuat melalui Phantom; provision gateway dan pembayaran invoice
          Devnet masih dalam persiapan. Mainnet belum diaktifkan.
        </p>
      </section>
    </>
  );
}
