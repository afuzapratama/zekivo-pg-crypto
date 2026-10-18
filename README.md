# Zekivo Gateway

Fondasi gateway Solana USDT/USDC untuk website Zekivo. **Localnet aktif; USDC Devnet tersedia melalui instance terpisah.** API dapat menerima mock USDT/USDC melalui validator lokal, memverifikasi finalized transfer dan mencatat ledger serta event outbox. Pengiriman webhook signed dengan retry dan receiver demo tersedia. Checkout sandbox responsif tersedia melalui checkout_url invoice. Mainnet/production ditolak pada startup.

- [Roadmap dan progres](docs/ROADMAP.md)
- [Setup wallet Devnet via Phantom](docs/DEVNET.md#setup-wallet-operator-yang-tersedia) — `pnpm devnet:setup`, alat operator terpisah di http://localhost:4400; gateway utama masih localnet.
- [Kontrak pembayaran](docs/PAYMENT-CONTRACT.md)
- [Adapter harga dan cara uji cache](docs/PRICING.md) — `pnpm pricing:inspect --devnet`; belum mengubah invoice v1.
- [Harga USD, sumber kurs dan draft integrasi Zekivo](docs/USD-PRICING-AND-QUOTES.md) — rancangan berikutnya; belum API aktif.
- [Stack](docs/DEVELOPMENT-STACK.md)
- [UI, shadcn/ui dan Scalar](docs/UI-DESIGN.md)
- [Riset](docs/RESEARCH-USDT-GATEWAY.md)

## Jalankan lokal

Prasyarat Node.js 24, pnpm 12.14.0, Docker dengan Compose.

```sh
npm install --global pnpm@12.14.0
pnpm install --frozen-lockfile
pnpm local:up
```

Web: http://localhost:3100. Panduan: http://localhost:3100/docs. Scalar API reference: http://localhost:3100/docs/api. Payment playground: http://localhost:3100/docs/playground. API health: http://localhost:4100/health. Readiness: http://localhost:4100/ready. OpenAPI: http://localhost:4100/openapi.json. Port database hanya bind localhost. Compose menunggu database sehat, lalu migration dan seed sebelum API/worker dimulai. Worker memantau dua akun token lokal dan menandai pembayaran setelah finalized. Solana RPC lokal: http://localhost:8899. Migration, seed project dan seed chain dijalankan sebelum API/worker.

Untuk mengubah UI lokal, folder `apps/web/app`, `apps/web/components`, dan `apps/web/lib` dipasang langsung ke container web. Perubahan dari IDE muncul melalui hot reload; penambahan dependency tetap memerlukan rebuild image.

Kredensial fixture **khusus lokal**: `zk_local_development_only`. Seed menolak environment selain local/localnet. Jangan gunakan fixture ini pada layanan publik.

```sh
curl -s http://localhost:4100/v1/invoices \
  -H 'Authorization: Bearer zk_local_development_only' \
  -H 'Idempotency-Key: example-order-1' \
  -H 'Content-Type: application/json' \
  -d '{"order_id":"example-order-1","asset":"USDC","amount":"25"}'
```

Ulangi request yang sama untuk menerima invoice yang sama. Ganti body dengan idempotency key yang sama untuk memeriksa 409. Buka `checkout_url` dari response untuk melihat checkout sandbox. Gunakan CLI mock payment di bawah untuk membayar tanpa dana asli; halaman checkout memperbarui status otomatis. Panduan: [CHECKOUT.md](docs/CHECKOUT.md).

## Rencana integrasi harga USD dari Zekivo

Backend Zekivo nantinya mengirim harga pesanan USD (misalnya `"25.83"`). Gateway
menghitung quote USDT/USDC, mengunci rate dan nominal token selama masa bayar,
lalu menambahkan identifikasi unik yang dicatat terpisah. Webhook akan membawa
nilai pesanan USD serta jumlah token diterima. Konversi ini tidak mencairkan token
menjadi USD dan tidak menjamin hasil penukaran fiat.

**API USD tersedia di lokal/Devnet melalui `POST /v2/invoices`.** API v1 di contoh sebelumnya tetap menerima `amount`
dalam token. Draft JSON lengkap, response quote, alur retry/expiry, dan tahapan
implementasi ada di [dokumen harga USD](docs/USD-PRICING-AND-QUOTES.md).
Rekomendasi awal: CoinGecko Demo untuk development/staging nonkomersial; provider
berlisensi komersial dan biaya tambahan ditinjau sebelum live. Belum ada pembelian
paket. Adapter harga/cache dan konversi decimal sudah dapat diuji melalui
`pnpm pricing:inspect --devnet`; key dibaca dari `.env.devnet`. Invoice USD menyimpan harga asli dan quote server; playground lokal sudah memakai input USD. Azure belum diperbarui. Lihat [panduan pricing](docs/PRICING.md).

## Development tanpa container aplikasi

```sh
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up -d postgres validator
pnpm db:migrate
pnpm db:seed
pnpm local:seed-chain
pnpm dev
```

Jika port 55432/3100/4100 terpakai, sesuaikan mapping Compose serta konfigurasi URL. Periksa `docker compose logs api worker migrate seed chain-seed validator` saat startup gagal. Migration dapat diulang. Jangan menjalankan migrate/seed dengan kredensial produksi.

## Pemeriksaan

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Unit test tidak membutuhkan database. Untuk integration test, pakai database test terpisah yang sudah dimigrasikan:

```sh
APP_ENV=test DATABASE_URL=postgres://gateway:localdev@localhost:55432/gateway_test pnpm db:migrate
TEST_DATABASE_URL=postgres://gateway:localdev@localhost:55432/gateway_test pnpm test
```

Integration test membuat project UUID sendiri dan membersihkan datanya. Test ini memeriksa concurrency lintas project, retry idempotent dan otorisasi terhadap PostgreSQL nyata. Tanpa TEST_DATABASE_URL, integration test ditandai skipped; itu bukan bukti lulus database.

## Stop dan reset

```sh
pnpm local:down
# Destruktif terhadap database DAN ledger chain lokal:
pnpm local:reset --confirm
```

Reset menghapus invoice/reservasi lokal. Jangan gunakan data hasil reset untuk mencocokkan pembayaran yang pernah dikirim. Auth admin masih fase berikutnya. Dokumentasi dan playground localnet tersedia di /docs dan /docs/playground. Pergantian aset tersedia untuk invoice dengan payment_options yang disetujui merchant; panduan [PAYMENT-ATTEMPTS.md](docs/PAYMENT-ATTEMPTS.md). Jangan menghapus hanya salah satu volume database/ledger lalu meneruskan histori lama; genesis mismatch akan menolak aktivasi pembayaran.

## Uji pembayaran mock lokal

Jika `.env` belum dibuat, gunakan `cp .env.example .env`. Buat invoice baru melalui contoh API di atas (ganti order/idempotency key bila sudah dipakai pada versi fondasi), lalu gunakan ID dari response:

```sh
pnpm local:pay <invoice-id>
# Transfer tanpa reference untuk menguji pencocokan nominal manual:
pnpm local:pay <invoice-id> --manual
# Pembayaran kurang: tetap masuk review/partial, tidak paid:
pnpm local:pay <invoice-id> 1
# Tiga skenario lengkap via API + chain + ledger + outbox:
pnpm local:smoke
```

Dari Docker, CLI tersedia lewat `docker compose exec api pnpm local:pay <invoice-id>` atau `docker compose exec api pnpm local:smoke`, tanpa mengisi DATABASE_URL host. Smoke menggunakan API in-process dengan middleware/schema yang sama dan scanner langsung; pemeriksaan HTTP worker dilakukan terpisah. Smoke menyimpan invoice/transfer contoh pada project sandbox, tidak menghapus data pengguna.

Pengiriman CLI menunggu finality; ini bisa membutuhkan belasan detik per transaksi. Status invoice dapat dicek lewat `GET /v1/invoices/<id>` dengan API key lokal. Seed chain hanya memakai signer fixture publik yang dapat direproduksi dan menolak endpoint non-lokal; jangan pernah memakai wallet fixture untuk menyimpan dana nyata.

Validator menggunakan binary resmi Agave 4.3.2 linux/amd64 yang diverifikasi SHA-256. Agave memerlukan io_uring: container validator lokal memakai seccomp unconfined, capability dihapus dan no-new-privileges; konfigurasi ini hanya untuk validator development, tidak untuk API/worker produksi. Host harus mendukung io_uring. Ledger disimpan dalam volume `solana-ledger`; restart biasa mempertahankan genesis dan saldo. Container API/worker tidak mendapat volume kunci validator.

Invoice lama dengan placeholder mint/recipient tetap `payment_enabled=false`. Invoice baru hanya aktif bila `CHAIN_MONITORING=true`, dua token config tersedia dan pemeriksaan genesis/mint/recipient RPC lulus. Mainnet tetap ditolak. Scanner saat ini hanya memproses finalized (belum menyediakan status confirming real-time), mendukung parsed transfer SPL legacy/versioned v0 dan inner instructions. RPC/transaksi yang tidak dapat dibaca membuat cursor tidak maju. Full reconciliation dan failover RPC masih terbuka di roadmap; delivery webhook dengan retry sudah tersedia.

### Checkpoint dan histori validator

Scanner menyimpan batas slot finalized dan memindai ulang overlap 32 slot; signature lama hanya menjadi informasi diagnostik, tidak dikirim sebagai parameter `until`. Batas slot tetap diperbarui saat akun tidak menerima transaksi. Ini menghindari error `Transaction ... not found` ketika signature terakhir sudah terpangkas dari histori validator lokal.

Migration `003_slot_checkpoints.sql` mempertahankan data invoice/ledger serta meng-upgrade checkpoint lama bila slotnya diketahui. Jika histori sudah terpangkas, hanya local/localnet yang boleh melanjutkan scan seluruh histori tersisa; rentang yang hilang dicatat pada tabel `scan_history_gaps`. Pencatatan ini tidak berarti transaksi yang sudah terhapus dari RPC bisa direkonstruksi. Di luar sandbox lokal, gap menghentikan scanner sampai sumber RPC dengan histori lengkap tersedia. Genesis mismatch tetap ditolak.

`local:smoke` menunggu transfer percobaannya benar-benar dicatat, termasuk ketika worker lain sedang memegang lock scanner. Status, ledger dan outbox dibaca dalam satu snapshot, lalu jumlahnya diperiksa lagi setelah scan ulang. Tidak perlu reset volume untuk memperbaiki checkpoint lama.

## Webhook lokal

Compose sekarang juga menjalankan receiver demo di http://localhost:4200. Variabel lokal baru ada di `.env.example`; setelah rebuild/seed, endpoint sandbox otomatis terdaftar untuk event baru.

```sh
docker compose exec api pnpm local:webhook-smoke
```

Uji ini menggunakan invoice HTTP dan mock token sungguhan pada validator lokal, lalu memeriksa signature, retry setelah timeout merchant, replay dan fulfillment satu kali. Panduan API, inbox dan mode kegagalan: [WEBHOOKS.md](docs/WEBHOOKS.md). Jalankan serial dengan pengujian lain yang memakai fault control receiver.

## Verifikasi visual checkout

```sh
pnpm exec playwright install --only-shell chromium
pnpm test:checkout
# Memerlukan seluruh Compose lokal (API, validator, worker, receiver):
pnpm test:checkout:chain
```

Suite pertama memeriksa UI fixture di tiga viewport Chromium, termasuk aksesibilitas, QR, clipboard, expiry dan koneksi ulang. Suite kedua mengirim mock USDT/USDC di localnet dari alur browser sampai webhook merchant. Panduan lengkap dan keterbatasan: [CHECKOUT.md](docs/CHECKOUT.md).

## Dokumentasi, playground dan Devnet

Buka http://localhost:3100/docs/playground untuk generate invoice, buka checkout, mengirim mock token tepat/kurang/lebih/manual dan melihat timeline webhook. Compose terbaru menambahkan local-tools; service tersebut memerlukan migration 006/007 yang otomatis dijalankan oleh local:up. Tidak ada reset volume.

Panduan dan batasan helper: [PLAYGROUND.md](docs/PLAYGROUND.md). Kebutuhan Devnet dan pekerjaan provision yang masih terbuka: [DEVNET.md](docs/DEVNET.md). Playground saat ini hanya localnet; Devnet belum diaktifkan hanya dengan menulis konfigurasi.

## Devnet USDC terpisah

Akun penerima USDC Devnet Zekivo sudah disiapkan. Jalankan dari terminal host:

```sh
pnpm devnet:init
pnpm devnet:up
pnpm devnet:invoice
# Setelah transfer ditandatangani dari Phantom pembeli:
pnpm devnet:inspect
```

Web Devnet http://localhost:13100/docs/devnet, API 14100, DB 55433. Localnet 3100/4100/55432 tetap terpisah. Jangan mengirim token Devnet ke invoice localnet. `.env.devnet` dan `.devnet/` berisi secret/capability privat dan diabaikan Git/Docker context. Devnet awal USDC saja; delivery webhook menunggu receiver HTTPS. Instruksi pembayaran, retry invoice dan batas scanner: [DEVNET.md](docs/DEVNET.md).

Panduan API daftar invoice (filter dan pagination): [docs/INVOICE-API.md](docs/INVOICE-API.md).

Akses dashboard operator: `/login`. Setup Entra dan session: [docs/ADMIN-AUTH.md](docs/ADMIN-AUTH.md). Login tetap ditutup sampai konfigurasi lengkap.

Dashboard baca dan batas akses: [docs/DASHBOARD.md](docs/DASHBOARD.md).

Project dan credential integrasi website: [docs/PROJECTS-API-KEYS.md](docs/PROJECTS-API-KEYS.md).

Panduan penanganan transaksi: [Review queue](docs/REVIEW-QUEUE.md).

Notifikasi admin dan pengujian email: [SMTP / Telegram / Mailpit](docs/NOTIFICATIONS.md).

Daftar transfer dan riwayat invoice: [Transactions](docs/TRANSACTIONS.md).

Operasional dan pemeriksaan pembayaran: [Monitoring / rekonsiliasi](docs/MONITORING.md).

Refund manual terverifikasi: [docs/REFUNDS.md](docs/REFUNDS.md).

Uji refund dengan token sementara dan transaksi validator lokal nyata:
`pnpm local:refund-smoke` (opsional `USDC` / `USDT`). Database fixture dibersihkan;
transaksi/token uji tetap berada di validator. Untuk menyiapkan uji wallet Devnet,
tersedia `pnpm devnet:refund-inspect <invoice-id> <destination-owner> <amount> [signature]`;
alat ini hanya membaca dan tidak mengirim/mencatat refund.
Lihat [panduan refund](docs/REFUNDS.md).

Target deployment berikutnya: [kesiapan staging Devnet](docs/STAGING-READINESS.md). Mainnet/produksi menunggu arahan terpisah.
