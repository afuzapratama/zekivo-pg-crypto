> Pembaruan implementasi localnet: invoice baru dapat mengembalikan payment_enabled=true setelah fixture/token config tervalidasi. Recipient, mint dan reference disertakan. Placeholder invoice lama tetap disabled. Finalized transfer, ledger dan payment.confirmed outbox sudah tersedia; delivery webhook confirmed dengan signature/retry sudah tersedia untuk sandbox; checkout sandbox serta pilihan aset berbasis quote merchant sudah tersedia. Kontrak terbaru attempt di [PAYMENT-ATTEMPTS.md](PAYMENT-ATTEMPTS.md). Detail penggunaan ada di README. Bagian bertanda foundation di bawah mendokumentasikan perilaku awal yang tetap berlaku pada invoice disabled.

# Kontrak pembayaran v1

Status: keputusan awal implementasi. Fase berikutnya boleh memperluas kontrak melalui perubahan terdokumentasi. Foundation release belum menerima transfer dan selalu mengembalikan payment_enabled=false.

## Model dan jumlah

Invoice mengikat project, external order ID dan harga yang dihitung backend merchant. Satu order memiliki satu invoice. Attempt mengikat pilihan aset, mint, recipient, reference, exact payable amount dan deadline; pembuatan invoice dapat mereservasi satu attempt per quote aset yang disetujui merchant; pemilihan aset mengaktifkan attempt tersebut tanpa menghapus attempt lama. MVP foundation mengunci satu aset pada pembuatan invoice dan menolak pembuatan ulang order dengan aset berbeda.

Jumlah input adalah string desimal positif dengan maksimal 6 digit pecahan dan maksimal 10 digit integer. Database memakai bigint base units. Response memakai string desimal tetap 6 digit. Tidak ada konversi fiat otomatis. USDT dan USDC dihitung terpisah; bukan jaminan nilai USD atau penukaran otomatis.

Default expiry 1.800 detik, rentang 60–3.600 detik. Tambahan nominal untuk transfer manual antara 1–9.999 base units (0.000001–0.009999 token), ditampilkan sebelum pembayaran. Gateway mencari total akhir yang belum pernah direservasi pada environment+cluster+mint+recipient, termasuk invoice expired dan paid, melintasi semua project dan harga dasar. Jika habis, response conflict; tidak memperbesar biaya atau mengganti quote secara diam-diam.

Dalam foundation release mint dan recipient berupa placeholder eksplisit dan tidak dikeluarkan sebagai alamat transfer. Nominal ini hanya untuk pengujian API; reservasi tidak boleh dimigrasikan menjadi invoice yang dapat dibayar tanpa membuat attempt tervalidasi.

## State dan pencocokan

State invoice: pending → confirming → paid; pending dapat menjadi expired. Confirming tidak otomatis expired karena transaksi mungkin sudah diterima sebelum deadline. State/finality transfer terpisah. Pada implementasi chain, transaksi gagal atau observasi yang hilang sebelum finality tidak boleh melunasi invoice.

Partial, overpaid, late, unmatched dan double payment adalah kategori review dengan transfer tersimpan; bukan instruksi bebas mark paid. Pembayaran tidak persis tanpa reference masuk review, tidak dicocokkan dengan >= atau toleransi. Pembayaran parsial tanpa identitas invoice kuat tidak otomatis digabung. Timestamp chain digunakan untuk kebijakan deadline, bukan waktu kedatangan webhook/RPC. Transfer yang baru terdeteksi setelah invoice expired tetapi terjadi sebelum deadline memerlukan evaluasi ulang berdasarkan bukti chain, dan pembaruan ledger/outbox atomik. Transfer yang benar-benar terjadi setelah deadline masuk late review.

Reference hanya mengidentifikasi intent; gateway tetap memverifikasi mint resmi, penerima, exact payable amount, transaksi berhasil dan finalized. Reference invoice A dengan nominal invoice B adalah konflik review, bukan fallback untuk melunasi B. Jalur manual memakai mint+recipient+exact total unik. Satu transfer (signature+instruction path) hanya boleh dialokasikan sekali. Double payment dipertahankan sebagai surplus/review dan tidak mengulangi fulfillment.

Ledger append-only mencatat alokasi dana dan koreksi terpisah; payment confirmed dan outbox ditulis dalam satu transaksi. Saldo wallet dapat mencakup transfer tanpa invoice dan transfer keluar, sehingga berbeda dari pendapatan invoice paid.

## API foundation

POST /v1/invoices membutuhkan Authorization: Bearer <merchant-key> dan Idempotency-Key 1–128 karakter. Body: order_id (1–128 karakter), asset USDT/USDC, amount string dan expires_in_seconds opsional. Tambahan field ditolak.

201 berarti invoice baru, 200 berarti replay request idempotent. Idempotency key sama dengan semantic body berbeda → 409. Nominal 25 dan 25.000000 dinormalisasi sebagai nilai sama. Default expiry dinormalisasi sebelum hashing. Order ID unik per project; key baru pada order yang sudah ada → 409. Reservasi historis tidak otomatis dihapus.

GET /v1/invoices/:id memerlukan merchant key project pemilik. Project lain mendapat 404. Error umum: 400 input/header tidak valid, 401 kredensial tidak valid, 404 tidak ditemukan, 409 konflik, 429 rate limit, 503 dependency tidak tersedia. Semua response jumlah berupa string; tidak menampilkan API key/hash, secret atau seed. Checkout URL adalah bearer capability dan harus diperlakukan rahasia.

Readiness memeriksa konektivitas dan migration database; health hanya menandakan proses hidup. Environment production/mainnet sengaja ditolak hingga readiness release selesai.

## Webhook v1 (fase 4)

Envelope: event_id, event_type, schema_version=1, occurred_at, project_id dan data berisi invoice_id, invoice_version, order_id, cluster, mint, asset, expected/received amount string dan transfer identifiers.

Events: payment.detected, payment.confirmed, payment.expired, payment.partial, payment.overpaid, payment.late. Review tanpa invoice disimpan internal. Tidak ada sweep event dalam scope satu alamat.

Header Zekivo-Timestamp dan Zekivo-Signature; signature hex HMAC-SHA256 atas timestamp+'.'+rawBody, secret endpoint. Timestamp Unix detik diperbarui setiap attempt; receiver memverifikasi toleransi 300 detik, constant-time comparison dan dedup event_id. Event ID tetap saat replay, envelope payload tetap, pengiriman tidak menjamin urutan. Receiver menangani invoice_version dan bisa mengambil state terkini melalui API.

Timeout 10 detik, retry exponential backoff+jitter dari 10 detik sampai maksimum 1 jam per interval, berhenti setelah umur delivery 24 jam lalu dead-letter. 2xx diterima. Replay manual tercatat dan tidak mengubah event_id. Merchant commit penerimaan event+fulfillment atomik sebelum ack; tidak mengandalkan redirect checkout.

## Kriteria penerimaan inti

| Kasus                            | Hasil                                     |
| -------------------------------- | ----------------------------------------- |
| Request valid                    | Satu invoice dengan total unik            |
| Request sama diulang/bersamaan   | ID dan total sama, satu insert            |
| Key sama body berubah            | 409                                       |
| Project lain membaca invoice     | 404                                       |
| Dua project dan nominal sama     | Total akhir berbeda untuk token yang sama |
| Invoice expired                  | Reservasi nominal tidak dipakai ulang     |
| Token/penerima/jumlah salah      | Tidak paid                                |
| Transfer belum finalized         | Tidak fulfillment                         |
| Reference konflik dengan nominal | Review                                    |
| Payment terlambat/double payment | Review, fulfillment maksimal sekali       |
| Scanner/webhook restart/retry    | Tidak menggandakan ledger/fulfillment     |
| Sandbox mengakses live           | Ditolak                                   |

## Keputusan yang ditunda

Attempt switching, review resolution, token verification, webhook delivery, OIDC dan public checkout belum diaktifkan pada foundation release. Halaman web saat ini hanya status development, bukan checkout atau dashboard. API ini tidak untuk traffic produksi.

List invoice (fase berikut): cursor pagination, limit default 25/maksimum 100, urutan created_at+id descending. Cursor harus scoped ke project dan filter; belum merupakan endpoint aktif pada foundation.

Implementasi delivery dan receiver lokal: [WEBHOOKS.md](WEBHOOKS.md). Event lifecycle selain confirmed masih pekerjaan state machine; receiver demo bukan backend Zekivo produksi.
