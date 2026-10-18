# Instruksi integrasi Zekivo → Zekivo Pay Gateway (staging)

Dokumen serah terima untuk developer/backend Zekivo. Lingkungan ini **staging
Solana Devnet**, bukan pembayaran uang nyata. USDC memakai token uji Devnet;
USDT memakai **Mock USDT**, bukan USDT mainnet. Tidak ada konversi fiat atau
pencairan USD otomatis.

## 1. Alamat layanan dan kondisi awal

| Kebutuhan                  | Alamat/status                                                            |
| -------------------------- | ------------------------------------------------------------------------ |
| Web/checkout/dashboard     | https://zkpgstg-web.nicebay-76e1d13a.southeastasia.azurecontainerapps.io |
| API backend                | https://zkpgstg-api.nicebay-76e1d13a.southeastasia.azurecontainerapps.io |
| API reference interaktif   | Web di atas + `/docs/api`                                                |
| Playground                 | Web di atas + `/docs/playground`                                         |
| OpenAPI                    | API di atas + `/openapi.json`                                            |
| Readiness                  | API di atas + `/ready`                                                   |
| Create invoice USD         | `POST /v2/invoices`                                                      |
| Baca status/detail         | `GET /v1/invoices/:id` — juga untuk invoice v2                           |
| Webhook delivery eksternal | **Masih nonaktif**, menunggu receiver Zekivo dan aktivasi operator PG    |

Layanan localnet dan Devnet lokal dihentikan agar pengujian diarahkan ke Azure.
Integrasi Zekivo tidak boleh bergantung pada localhost, database PG, RPC internal,
private key wallet PG, atau runner mock lokal.

Playground staging memakai API key yang dimasukkan operator sendiri, hanya dalam
memori halaman. Ini alat pengujian manual; kode aplikasi Zekivo tetap memanggil
PG dari backend. Playground tidak mengirim token otomatis dan tidak membuktikan
signature receiver hanya dari status delivery.

## 2. Yang harus disiapkan kedua pihak

**Developer/operator Zekivo:**

- Satu backend dan database **staging** Zekivo; order pengujian tidak boleh memenuhi
  pesanan produksi. Jika UI Zekivo produksi digunakan untuk akses, pisahkan data,
  fulfillment, API key dan feature flag staging secara tegas.
- URL receiver HTTPS publik, misalnya
  `https://<host-staging-zekivo>/webhooks/zekivo-pg`. Ini contoh rute yang dibuat di
  Zekivo, bukan rute yang sudah tersedia di gateway.
- HTTPS port 443, sertifikat valid, DNS publik, tanpa redirect/login/CAPTCHA pada
  receiver. Private/localhost/tunnel beralamat privat tidak diterima.
- Tempat menyimpan API key dan signing secret di server/secret manager.
- Jam server tersinkronisasi, akses keluar HTTPS ke API PG, dan endpoint webhook
  yang dapat menerima POST dari internet. Jangan bergantung pada satu IP egress
  tetap Azure; autentikasi webhook menggunakan HMAC.
- Wallet **pembeli** pada Devnet, SOL Devnet untuk fee, serta USDC Devnet atau Mock
  USDT dengan mint yang sesuai invoice. Jangan mengirim token mainnet.

**Operator PG:**

- Buat/pilih project staging untuk situs Zekivo, catat `project_id`, dan terbitkan
  API key project melalui Dashboard → Projects. Gunakan key terpisah per project;
  nama project adalah identitas integrasi, bukan nama jaringan atau wallet.
- Serahkan key melalui kanal rahasia, bukan dokumen ini, Git, screenshot atau URL.
- Daftarkan receiver, simpan signing secret pada Zekivo, lalu aktifkan dispatcher
  staging secara terkontrol. Bicep saat ini masih `WEBHOOK_DELIVERY=false`;
  perubahan harus masuk konfigurasi deployment dan diterapkan ulang agar tidak
  hilang pada rilis berikutnya. API/worker memakai encryption key yang sama dari
  Key Vault. Tidak perlu mengaktifkan `LOCAL_PLAYGROUND` di Azure.
- Daftarkan endpoint **sebelum** membuat invoice pengujian/pembayaran. Event lama
  sebelum endpoint terdaftar tidak dibuatkan delivery retroaktif.

## 3. Konfigurasi backend Zekivo

Nama variabel berikut adalah usulan untuk **aplikasi Zekivo**, bukan variabel
runtime PG yang harus disalin ke Azure PG.

```dotenv
ZEKIVO_PG_API_BASE_URL=https://zkpgstg-api.nicebay-76e1d13a.southeastasia.azurecontainerapps.io
ZEKIVO_PG_CHECKOUT_ORIGIN=https://zkpgstg-web.nicebay-76e1d13a.southeastasia.azurecontainerapps.io
ZEKIVO_PG_ENVIRONMENT=staging
ZEKIVO_PG_CLUSTER=devnet
ZEKIVO_PG_PROJECT_ID=<project-uuid-dari-operator>
ZEKIVO_PG_API_KEY=<secret-api-key>
ZEKIVO_PG_WEBHOOK_SECRET=<secret-signing-endpoint>
```

Jangan menggunakan prefix publik seperti `NEXT_PUBLIC_` untuk secret. API key
merchant berbeda dari webhook signing secret, Entra client secret dan encryption
key internal PG. Zekivo tidak perlu CoinGecko key, kredensial Azure atau akses
Microsoft dashboard PG untuk transaksi backend.

## 4. Alur checkout yang harus dibuat

1. Pembeli memilih pembayaran crypto di Zekivo.
2. Backend Zekivo menghitung total final pesanan dalam USD dari data server
   (diskon, ongkir, pajak jika berlaku). Jangan mempercayai harga dari browser.
3. Simpan order, nomor payment session, payload USD dan idempotency key **sebelum**
   memanggil PG. Lock/unique constraint mencegah klik ganda membuat session ganda.
4. Backend memanggil `POST /v2/invoices` dengan Bearer API key project.
5. Simpan hasil PG, lalu kirim hanya data tampilan/`checkout_url` ke browser.
   Validasi origin checkout terhadap konfigurasi sebelum redirect.
6. Arahkan pembeli ke hosted checkout PG. Pembeli memindai QR atau membuka wallet
   dan membayar nominal token persis pada jaringan Devnet.
7. Zekivo menerima webhook, memverifikasi signature dan memprosesnya idempotent.
   Status order ditampilkan dari backend Zekivo; refresh browser bukan bukti bayar.
8. Jika webhook terganggu, backend merekonsiliasi melalui detail invoice PG.

Tidak ada `return_url`, `cancel_url`, email pembeli, callback URL atau item list
pada kontrak create invoice saat ini. Jangan menambah field tersebut karena
`additionalProperties=false`. Pengalihan balik otomatis ke Zekivo belum
tersedia; sediakan halaman status order Zekivo yang dapat dibuka kembali.

## 5. Request create invoice USD

```http
POST /v2/invoices
Authorization: Bearer <ZEKIVO_PG_API_KEY>
Idempotency-Key: zkv-payment-session-<uuid>
Content-Type: application/json
```

```json
{
  "order_id": "ZKV-STG-ORDER-001-PAY-01",
  "price_currency": "USD",
  "price_amount": "25.83",
  "payment_asset": "USDC",
  "allowed_payment_assets": ["USDC", "USDT"],
  "network": "solana",
  "expires_in_seconds": 900,
  "description": "Pembayaran pesanan ZKV-STG-ORDER-001",
  "metadata": {
    "site": "zekivo.com",
    "order_reference": "ZKV-STG-ORDER-001"
  }
}
```

| Field                    | Aturan                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `order_id`               | Wajib, string 1–128; gunakan identitas payment session yang dipetakan ke order bisnis          |
| `price_currency`         | Wajib, hanya `USD`                                                                             |
| `price_amount`           | Wajib, string positif tepat 2 desimal, maksimal 10 digit sebelum titik; bukan number/float     |
| `payment_asset`          | Wajib, `USDC` atau `USDT`                                                                      |
| `allowed_payment_assets` | Opsional, 1–2 aset unik, harus mencakup aset awal; jika tidak dikirim hanya aset awal          |
| `network`                | Wajib, `solana`; cluster Devnet ditetapkan server, bukan body                                  |
| `expires_in_seconds`     | 60–900, default 900                                                                            |
| `description`            | Opsional, maksimal 200 karakter                                                                |
| `metadata`               | Opsional, maksimal 20 properti string, tiap nilai maksimal 256 karakter; jangan isi PII/secret |

`Idempotency-Key` 1–128 karakter; simpan satu key tetap per payment session.
Request awal sukses 201; replay sukses 200. Payload berbeda pada key sama 409.
Timeout/5xx/429 harus dicoba ulang dengan key **dan payload yang sama**, backoff
terbatas serta menghormati Retry-After bila tersedia. Jangan membuat key/order baru
hanya karena respons hilang. Catatan: create endpoint memeriksa ketersediaan chain
sebelum masuk replay; gangguan chain masih dapat menghasilkan 503 pada retry.

Jika perlu invoice baru setelah expiry, buat payment session baru yang terhubung
ke order sama. Cegah fulfillment ganda bila invoice lama kemudian menjadi paid.

## 6. Response dan penyimpanan

Contoh ilustratif: nilai token/kurs berikut **bukan harga yang harus di-hardcode**.
Respons dapat menyertakan field tambahan; consumer harus kompatibel.

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "invoice_version": 1,
  "order_id": "ZKV-STG-ORDER-001-PAY-01",
  "price_currency": "USD",
  "price_amount": "25.83",
  "asset": "USDC",
  "cluster": "devnet",
  "status": "pending",
  "amount": "25.835766",
  "payable_amount": "25.835767",
  "expires_at": "2026-10-18T01:15:00.000Z",
  "checkout_url": "https://zkpgstg-web.nicebay-76e1d13a.southeastasia.azurecontainerapps.io/pay/<checkout-token>",
  "payment_enabled": true,
  "recipient": "<alamat-wallet-penerima>",
  "mint": "<mint-USDC-Devnet>",
  "reference": "<reference-pembayaran>",
  "quote": {
    "id": "22222222-2222-4222-8222-222222222222",
    "source": "coingecko-demo",
    "market_asset_id": "usd-coin",
    "rate_usd_per_token": "0.9997768446168809",
    "rate_source_updated_at": "2026-10-18T00:59:30.000Z",
    "fetched_at": "2026-10-18T01:00:00.000Z",
    "converted_amount": "25.835766",
    "rounding": "ceil_token_6",
    "policy_version": "usd-quote-v1",
    "expires_at": "2026-10-18T01:15:00.000Z"
  }
}
```

Simpan minimal: business order ID, payment session ID, project/environment/cluster,
payload create asli, idempotency key, PG invoice ID, harga asli USD, aset awal dan
aset yang diizinkan, quote response, amount/payable, mint/recipient/reference,
expiry, status PG, versi PG, checkout URL, serta waktu create/update. Checkout URL
adalah capability link privat; jangan log token atau memasukkannya ke analytics.

USD adalah harga pesanan Zekivo. `amount` adalah hasil konversi token dibulatkan
naik 6 desimal; `payable_amount` menambahkan kode unik identifikasi pembayaran.
PG mengambil harga pasar dan menyimpan quote, bukan selalu menganggap 1 token =
1 USD. Zekivo tidak menghitung ulang payable dari kurs sendiri.

Jika pembeli mengganti aset di checkout, ambil detail terbaru sebelum menilai
pembayaran. Jangan membandingkan pembayaran USDT dengan nominal USDC awal.
Harga asli USD dan expiry tetap; quote tiap aset sudah ditetapkan PG.

## 7. Status, error dan rekonsiliasi

```http
GET /v1/invoices/<invoice_id>
Authorization: Bearer <ZEKIVO_PG_API_KEY>
```

Cari kembali invoice jika respons create hilang:
`GET /v1/invoices?order_id=<urlencoded-session-order-id>&limit=25`.
List mengembalikan `{items,next_cursor}` tanpa checkout URL; ambil detail untuk
URL checkout. Scope API key melindungi project dan environment.

| HTTP                      | Tindakan Zekivo                                                        |
| ------------------------- | ---------------------------------------------------------------------- |
| 400                       | Perbaiki input; jangan retry buta                                      |
| 401                       | Key tidak valid/revoked/expired; periksa secret staging                |
| 404                       | Invoice tidak ada dalam scope key; jangan menganggap paid/expired      |
| 409                       | Konflik idempotency/payload; cocokkan session yang tersimpan           |
| 429                       | Backoff dan hormati Retry-After bila tersedia                          |
| 503 `pricing_unavailable` | Harga/quota/provider belum siap; jangan pakai kurs buatan              |
| 503 `chain_unavailable`   | Chain/RPC belum siap; jangan menawarkan transfer tanpa instruksi valid |
| Timeout/5xx lainnya       | Hasil bisa belum pasti; retry request yang sama, cek order/invoice     |

Polling halaman order Zekivo memanggil backend Zekivo. Jika perlu, backend polling
PG tiap 5–10 detik selama pending dengan timeout dan backoff, bukan setiap render
pengguna. Rekonsiliasi background menangani webhook hilang, order stuck dan
restart. Status gateway: `pending`, `confirming`, `paid`, `expired`; observasi
pre-finality belum menjadi event tersendiri, sehingga confirming tidak harus
terlihat. Review adalah flag/alur terpisah, bukan bukti order sudah terbayar.

## 8. Pendaftaran webhook

Dari backend/terminal operator aman:

```http
POST /v1/webhook-endpoints
Authorization: Bearer <ZEKIVO_PG_API_KEY>
Content-Type: application/json

{"url":"https://<host-staging-zekivo>/webhooks/zekivo-pg"}
```

Respons 201 berisi `id`, `url`, `signing_secret`. Secret hanya ditampilkan saat
create/rotate: simpan segera pada secret manager Zekivo. Jangan menganggap create
endpoint merchant idempotent; jika respons hilang, cek `GET /v1/webhook-endpoints`
sebelum mendaftarkan ulang. URL yang sudah ada menghasilkan 409. Bila secret
hilang, rotasi secara terkoordinasi.

Alternatif: operator dashboard PG memilih project → Webhooks → daftarkan URL.
Secret tetap ditransfer terpisah secara aman. Semua enam event dikirim ke endpoint
aktif; belum ada parameter filter subscriptions pada create endpoint.

## 9. Signature receiver — wajib sebelum mempercayai JSON

PG mengirim:

- `Zekivo-Timestamp`: Unix seconds waktu delivery attempt.
- `Zekivo-Signature`: lowercase hex HMAC-SHA256.
- `Zekivo-Event-Id`: ID event, harus sama dengan `event_id` body.

Data yang ditandatangani: `timestamp + "." + rawBody`. Gunakan byte body asli
sebelum JSON parser, bukan JSON yang diserialisasi ulang. Tolak timestamp di luar
±300 detik. Secret dipakai sebagai **string lengkap termasuk `whsec_`**, bukan
hex-decoding suffix. Rotasi/retry menandatangani ulang memakai secret endpoint
terkini dan timestamp baru.

Contoh helper Node.js untuk backend Zekivo (adaptasikan dengan framework):

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyPgWebhook(rawBody, timestamp, signature, secret) {
  if (!Buffer.isBuffer(rawBody) || typeof secret !== "string" || !secret)
    return false;
  if (typeof timestamp !== "string" || !/^\d{1,12}$/.test(timestamp))
    return false;
  if (typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature))
    return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300)
    return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
```

Framework harus mempertahankan raw bytes pada **rute receiver saja**, membatasi
ukuran body (misalnya 64 KiB), menolak header duplikat/format tidak valid, lalu
parse JSON setelah HMAC lolos. Receiver webhook tidak memakai CSRF browser;
pengecualian CSRF hanya pada rute ini dan digantikan validasi HMAC, bukan menonaktifkan
proteksi seluruh aplikasi. Jangan memakai cookie/login browser pada rute receiver.

## 10. Event dan aturan pemrosesan

Envelope schema 1 memiliki `event_id`, `event_type`, `schema_version`,
`occurred_at`, `project_id`, dan `data`. Invoice USD menambahkan
`data.price_currency`, `data.price_amount`, dan `data.quote`. Izinkan field tambahan.

| Event                     | Tindakan                                                                     |
| ------------------------- | ---------------------------------------------------------------------------- |
| `payment.confirmed`       | Kandidat paid; validasi order dan detail PG sebelum fulfillment tepat sekali |
| `payment.expired`         | Tutup pembayaran session pending; jangan menurunkan order yang sudah paid    |
| `payment.partial`         | Review; pembayaran kurang tidak dijumlahkan otomatis                         |
| `payment.overpaid`        | Review; jangan otomatis mengirim barang/refund                               |
| `payment.late`            | Review; transfer lewat expiry bukan auto-paid                                |
| `payment.review_required` | Review duplicate/reference conflict/inactive attempt/predates invoice        |

Confirmed memuat `data.invoice_id`, `invoice_version`, `attempt_id`, `transfer_id`,
`invoice_status="paid"`, `order_id`, `cluster`, `asset`, `mint`, `recipient`,
`amount_expected`, `amount_received`, `finality="finalized"`, dan
`transfers:[{signature,instruction_path,slot}]`.

Review juga memuat `reason`, `received_asset`, `received_mint`,
`received_recipient`. Jangan menyamakan token yang diterima dengan token yang
seharusnya dibayar. Expired memuat expiry dan transfers kosong, tanpa klaim
finality atau amount_received. `payment.detected`, refund event, invoice.created,
invoicing email dan refund otomatis **belum tersedia**.

**Pola pemrosesan yang harus diimplementasikan Zekivo:**

1. Verifikasi HMAC/timestamp, JSON schema, event header/body dan project yang
   diharapkan. Simpan event valid ke durable inbox dengan unique `event_id` dan
   hash body. Insert receipt dan enqueue pekerjaan pada **satu transaksi**.
2. Balas 2xx hanya setelah commit inbox/job. Jangan ACK lalu menyimpan event di
   memori. Duplicate event valid yang sama dibalas 2xx tanpa efek ganda. Event ID
   sama dengan hash body berbeda harus menjadi alert, bukan menimpa bukti lama.
3. Worker inbox mencocokkan invoice ID/order_id ke payment session tersimpan.
   Unknown order/invoice/project ditahan untuk investigasi, tidak membuat order
   baru otomatis dari webhook.
4. Untuk confirmed, ambil detail invoice dari API PG memakai API key server.
   Validasi status `paid`, project/session yang dikenal, cluster Devnet, harga USD
   identik dengan order server, aset yang diizinkan, mint/recipient yang sesuai
   konfigurasi serta nominal event sesuai invoice/attempt yang diselesaikan.
   `amount_expected` dan `amount_received` harus sama persis dalam unit token
   enam desimal, finality finalized. Jangan membandingkan float atau hanya simbol
   USDT/USDC. Quote/aset awal bisa berubah karena pilihan aset di checkout.
5. Lock order/payment session dan commit perubahan payment, fulfillment outbox
   serta status inbox atomik. Unique constraint business order/fulfillment mencegah
   pengiriman barang dua kali, termasuk bila dua invoice berbeda sama-sama paid.
6. Worker job mempunyai retry/dead-letter dan rekonsiliasi; bila API PG sedang
   gagal, jangan menyimpulkan unpaid atau membuang confirmed yang valid.

Alternatif tanpa durable inbox: proses receipt + perubahan order + fulfillment
outbox dalam satu transaksi sebelum 2xx; bila gagal, balas 5xx agar PG retry.
Jangan menggabungkan ACK cepat dengan pemrosesan non-durable.

Event bisa duplikat/tidak berurutan. Gunakan versi untuk menghindari kemunduran
state, tetapi **jangan membuang confirmed valid hanya karena versi lebih kecil
dari review yang datang lebih dahulu**. Confirmed dapat tiba setelah expired
untuk pembayaran on-time yang terlambat ditemukan scanner. Paid tidak pernah
kembali pending/expired karena event terlambat. Pembayaran ekstra pada order
sudah fulfilled masuk review, bukan fulfillment/refund otomatis.

## 11. Delivery, retry dan operasional

- Deadline PG 10 detik; receiver disarankan ACK inbox cepat, lalu proses job.
- Hanya 2xx sukses. Redirect, 4xx/5xx, timeout dan error jaringan di-retry.
- Backoff exponential berjitter, basis 10 detik, maksimum interval 1 jam;
  delivery dead setelah 24 jam cycle. Jangan menunggu retry tanpa monitoring.
- `GET /v1/webhook-deliveries?invoice_id=<uuid>&limit=25` untuk memantau delivery;
  lanjutkan `before` bila ada pagination. Status delivered berarti HTTP 2xx,
  bukan bukti bahwa order sudah dipenuhi atau signature sudah diverifikasi.
- `GET /v1/webhook-deliveries/:id/attempts` untuk diagnosa.
- `POST /v1/webhook-deliveries/:id/replay` untuk mengirim ulang event yang sama;
  replay tidak membuat transaksi atau pembayaran baru. Lease inflight dapat 409.
- Rotasi secret: receiver menerima key baru dan lama selama transisi, kemudian
  operator PG merotasi endpoint. Signing attempt berikutnya menggunakan secret
  terkini. Jangan mengganti encryption key internal PG untuk rotasi receiver.
- Alert Zekivo: invalid signature, job inbox dead, payment/order mismatch, paid
  tanpa fulfillment, duplicate payment, delivery dead, key invalid dan pricing/RPC
  unavailable. Log hanya ID internal/kode error; jangan log secret/Authorization,
  signature header, raw payload PII atau checkout capability token.

## 12. Checklist pekerjaan Zekivo dan acceptance staging

- [ ] Konfigurasi staging dan secret terpisah dari produksi.
- [ ] Tabel payment sessions + mapping order, payload/idempotency persisten.
- [ ] Backend create/read/list invoice dengan timeout, retry aman, error mapping.
- [ ] UI pilihan crypto, redirect hosted checkout dan halaman status order.
- [ ] Receiver raw-body HMAC + timestamp/header/project/schema validation.
- [ ] Durable inbox/job + dedup + order lock + fulfillment outbox/unique constraint.
- [ ] Penanganan expired/review tanpa auto-fulfillment/refund.
- [ ] Rekonsiliasi background dan alert mismatch/dead-letter.
- [ ] URL receiver diserahkan ke operator PG; signing secret dipasang di Zekivo.
- [ ] Operator mengaktifkan delivery staging sebelum invoice uji baru dibuat.
- [ ] Order USD `25.83` dibuat dari backend, tampil identik di checkout.
- [ ] Pembayaran tepat USDC Devnet → paid → signed webhook → order fulfilled sekali.
- [ ] Ulangi dengan Mock USDT yang mint-nya sesuai invoice.
- [ ] Dua aset: ganti aset di checkout; nilai USD tetap dan nominal token benar.
- [ ] Double-click/retry create tidak membuat invoice ganda.
- [ ] Replay webhook/ACK hilang/receiver 5xx tidak menggandakan fulfillment.
- [ ] Invalid signature, timestamp kedaluwarsa, project/invoice asing tidak fulfill.
- [ ] Partial/overpaid/late/salah mint masuk review atau unmatched, tidak auto-paid.
- [ ] Event out-of-order dan dua session untuk satu order tetap fulfill sekali.
- [ ] Bukti pengujian dicatat tanpa secret/capability URL.

**Data yang perlu dikirim tim Zekivo berikutnya:** URL receiver HTTPS staging,
nama project/situs yang digunakan, stack backend/framework untuk pemasangan
raw-body handler, dan ID order uji (tanpa data pribadi). Secret diberikan melalui
kanal aman terpisah. Setelah checklist lulus barulah membahas gate produksi;
mengganti URL staging menjadi mainnet saja tidak cukup.
