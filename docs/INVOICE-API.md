# API daftar invoice

`GET /v1/invoices` memerlukan Bearer API key merchant. Hasil hanya mencakup
project pemilik key, environment aplikasi dan cluster instance API. Key yang
sudah dicabut tidak dapat mengakses daftar. Endpoint detail
`GET /v1/invoices/:id` memakai pembatasan yang sama.

## Filter dan halaman

| Parameter  | Nilai                                      | Default/perilaku                                |
| ---------- | ------------------------------------------ | ----------------------------------------------- |
| `limit`    | Integer 1–100                              | 25                                              |
| `status`   | `pending`, `confirming`, `paid`, `expired` | Semua status                                    |
| `asset`    | `USDT`, `USDC`                             | Aset invoice yang dipilih/diselesaikan saat ini |
| `order_id` | String 1–128 karakter                      | Pencocokan persis, bukan pencarian substring    |
| `before`   | UUID dari `next_cursor`                    | Ambil halaman berikutnya                        |

```sh
curl 'http://localhost:14100/v1/invoices?status=paid&asset=USDT&limit=25' \
  -H "Authorization: Bearer $ZEKIVO_API_KEY"
```

Gunakan key milik environment yang dituju, hanya dari backend/terminal operator;
jangan menanamkan merchant key ke frontend. Localnet API memakai port 4100;
instance Devnet terpisah memakai port 14100.

Respons berbentuk `{ "items": [...], "next_cursor": "uuid-atau-null" }`.
Setiap item berisi `id`, `order_id`, `invoice_version`, `asset`, `cluster`,
`status`, `amount`, `payable_amount`, `created_at`, `expires_at` dan
`payment_enabled`. Amount adalah string desimal 6 digit sesuai endpoint detail.
Daftar tidak mengembalikan checkout token/URL, API key, atau data project lain.
Ambil detail invoice terotorisasi jika memerlukan instruksi checkout.

Urutan: `created_at DESC, id DESC`. Lanjutkan dengan `before=next_cursor`,
pertahankan filter yang sama; `next_cursor=null` berarti tidak ada halaman
berikutnya pada saat query. Timestamp cursor dibandingkan dalam PostgreSQL agar
precision mikrodetik tidak hilang akibat konversi JavaScript Date. UUID menjadi
tie-breaker ketika timestamp sama. Invoice baru yang dibuat setelah halaman
pertama tampil pada refresh dari halaman pertama, bukan menyisip ke halaman
lanjutan yang lebih lama.

Daftar ini membaca status saat ini, bukan snapshot historis. Status/aset yang
berubah selama pagination dapat mengubah keanggotaan hasil filter; untuk
rekonsiliasi gunakan detail/status terbaru, bukan asumsi jumlah item tetap.
Cursor yang tidak ada atau berasal dari scope lain menghasilkan HTTP 400
`invalid_cursor` tanpa menjelaskan kepemilikannya. Query/enum/limit yang tidak
valid menghasilkan 400; key hilang/tidak valid/revoked menghasilkan 401.
Detail yang tidak ada dalam scope menghasilkan 404. Respons sukses daftar dan
detail menggunakan `Cache-Control: no-store`.

Kontrak query dan respons daftar tersedia otomatis dalam OpenAPI `/openapi.json`
dan Scalar `/docs/api`. Daftar invoice ini belum menyediakan timeline transfer,
review queue, export atau dashboard admin; pekerjaan tersebut mengikuti Fase 7.

## Verifikasi

`tests/invoice-list.integration.test.ts` memeriksa filter gabungan, halaman tanpa
skip pada timestamp identik dan selisih mikrodetik, precision amount, pembatasan
project/environment/cluster, cursor asing, key revoked, validasi query serta
schema OpenAPI. Fixture memakai project test tersendiri dan dibersihkan setelah
pengujian; pembayaran pengguna tidak direset.

## Invoice USD (v2, localnet/Devnet)

`POST /v2/invoices` memakai autentikasi project dan `Idempotency-Key` yang sama
seperti v1. V1 tetap menerima nominal token. Contoh body v2:

```json
{
  "order_id": "ZKV-123",
  "price_currency": "USD",
  "price_amount": "25.83",
  "payment_asset": "USDT",
  "allowed_payment_assets": ["USDT", "USDC"],
  "network": "solana",
  "expires_in_seconds": 900
}
```

USD harus string dua desimal, positif. Durasi 60–900 detik; maksimum quote tidak
memperpanjang masa invoice saat aset dipilih ulang. Gateway mengambil harga valid,
menghitung token dengan pembulatan naik enam desimal dan mengalokasikan tambahan
identifikasi. Original `price_currency`/`price_amount`, snapshot `quote` per aset,
dan payload USD disimpan bersama invoice dalam transaksi yang sama.

Response merchant dan checkout menampilkan harga USD terpisah dari `amount`
(token sebelum kode unik) dan `payable_amount` (token persis yang harus dikirim).
Retry mengembalikan invoice semula tanpa mengambil kurs baru; payload berbeda
pada key sama konflik. Record quote lama tetap dipakai saat ganti aset, dengan
batas waktu invoice yang sama. Aset di luar konfigurasi ditolak. Jika pricing
belum dikonfigurasi/tidak tersedia, quote baru ditolak 503; invoice lama tetap bisa
dibaca. Provider fixture hanya untuk localnet/testing. Detail adapter: PRICING.md.

Event webhook invoice USD menambahkan `price_currency`, `price_amount` dan
snapshot `quote` pada `data`, tanpa mengubah arti field token atau nomor schema
v1 yang sudah ada. Consumer sebaiknya menerima field tambahan. Fulfillment tetap
berdasarkan `payment.confirmed` signed dan idempotent, bukan jumlah USD dari
browser atau redirect checkout. Dukungan ini belum dideploy ke Azure.
