# Keputusan stack development

Acuan urutan implementasi dan checklist produksi: [Roadmap proyek](ROADMAP.md). Scope v1 mengikuti roadmap; alternatif historis pada riset bukan tugas implementasi aktif.

Status: stack dipilih, 17 Oktober 2026. Fondasi workspace, web development, API invoice dan database mulai diimplementasikan. Watcher finalized localnet dan ledger/outbox awal tersedia. Playground dan dashboard belum tersedia; progres rinci mengikuti roadmap.

## Stack

| Lapisan               | Pilihan                                               | Tujuan                                                                         |
| --------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| Bahasa/runtime        | TypeScript strict, Node.js LTS                        | Satu bahasa untuk UI, API dan worker; versi kompatibel dikunci saat bootstrap. |
| Monorepo              | pnpm workspaces                                       | Berbagi kontrak API, konfigurasi dan komponen UI.                              |
| Frontend              | Next.js App Router, React                             | Dashboard, checkout, dokumentasi dan playground dalam satu aplikasi web.       |
| UI                    | Tailwind CSS v4, shadcn/ui, Lucide                    | Komponen aksesibel, responsif mobile/desktop dan tema konsisten.               |
| API                   | Fastify, JSON Schema, OpenAPI                         | Kontrak request/response tervalidasi dan dokumentasi API.                      |
| Database              | PostgreSQL, node-postgres, SQL migrations             | Unique constraint, row locking dan transaksi eksplisit untuk pembayaran.       |
| Pekerjaan background  | Outbox + antrean PostgreSQL                           | Webhook retry, rekonsiliasi dan scan; claim dengan locking dan lease.          |
| Solana                | @solana/kit dan SPL Token client yang kompatibel      | RPC, decode transfer, validasi mint dan transaksi sandbox.                     |
| Dokumentasi           | Panduan React dalam aplikasi web + Scalar/OpenAPI     | Panduan integrasi, contoh request dan playground.                              |
| Pengujian             | Vitest, Playwright, local validator                   | Unit/domain, integrasi database/chain dan alur browser responsif.              |
| Logging/observability | Pino JSON logs, health/readiness, metrik              | Trace invoice/transfer/event dengan correlation ID; redaksi secret.            |
| Auth admin            | OIDC melalui Microsoft Entra ID, MFA                  | Session server-side, RBAC; akun development terpisah.                          |
| Packaging             | Docker multistage, Docker Compose                     | Pengembangan lokal dan image deploy yang konsisten.                            |
| Azure produksi        | Container Apps, PostgreSQL Flexible Server, Key Vault | API/worker terpisah, database durable dan managed identity.                    |

Versi dependency dipilih dari rilis stabil kompatibel pada bootstrap dan dikunci dalam lockfile. Kontrak Solana Pay/reference harus diuji kompatibilitas SDK; adapter compatibility diisolasi bila library pendukung masih memakai SDK lama. Tidak perlu smart contract khusus untuk menerima transfer SPL standar.

## Struktur rencana

```text
apps/
  web/             # /dashboard, /pay/:token, /docs, /docs/playground
  api/             # /v1/invoices, invoice status, admin API
  worker/          # watcher, reconciler, outbox dan webhook delivery
packages/
  domain/          # invoice state, exact amount allocation dan aturan pembayaran
  database/        # SQL migrations, query dan transaksi
  solana/          # cluster config, mint allowlist, decoder dan RPC
  contracts/       # JSON Schema, API types dan generator OpenAPI
  ui/              # komponen UI bersama
  config/          # validasi environment dan konfigurasi tooling
  testkit/         # seed, fixtures dan pengirim token sandbox
infra/
  docker/          # Dockerfile dan Compose
  azure/           # deployment configuration; dibuat saat deployment disiapkan
```

Arsitektur modular satu repository. API dan worker dijalankan sebagai proses terpisah; domain dan database sama. Tidak menambah Redis, Kafka atau Kubernetes pada MVP.

## Playground dokumentasi

Tujuan: developer bisa mencoba invoice → pembayaran → finality → webhook tanpa crypto asli. Playground menggunakan endpoint invoice yang sama dengan integrasi merchant, dengan kredensial sandbox scoped yang hanya tersedia melalui session backend. Secret merchant produksi tidak pernah dikirim ke browser.

Panel input: project sandbox, USDT/USDC, harga, external order ID dan expiry. Gateway menetapkan total unik/reference; browser tidak menentukan harga invoice live.

Panel output: request curl tersanitasi, response JSON, invoice ID, checkout URL, nominal, jaringan dan status. Token checkout bersifat rahasia; jangan menyimpannya dalam log analitik publik.

Aksi pengujian:

1. Generate invoice sandbox dan buka checkout responsif.
2. Localnet: kirim SPL mock token melalui test wallet fixture dengan nominal tepat, kurang atau lebih. Ini menghasilkan transaksi chain nyata pada validator lokal.
3. Devnet: hubungkan wallet mode devnet, kirim USDC faucet atau mock USDT; signing melalui wallet pengguna. Jangan menyediakan faucet signing key sebagai API publik.
4. Amati timeline invoice created, transfer observed, finalized, invoice paid dan webhook delivery.
5. Inspect payload/signature dan status response di webhook inbox sandbox internal; retry/replay untuk menguji idempotency.
6. Trigger skenario expiry, duplicate webhook dan merchant receiver gagal melalui kontrol khusus localnet/sandbox.

Mode simulasi cepat jika disediakan harus dilabeli Simulation, terpisah dari pengujian chain. Tidak boleh memalsukan konfirmasi transaksi atau memanggil transisi paid arbitrer di produksi. Local helper sender tidak didaftarkan pada deployment live. Devnet helper berbasis wallet tidak boleh menerima seed dari pengguna.

Dokumentasi publik tetap bisa dibaca tanpa login. Playground hosted memakai session sandbox dengan kuota/rate limit dan project terisolasi; tidak memberi anonymous arbitrary webhook proxy. MVP memakai webhook inbox internal; custom endpoint hanya untuk project terautentikasi dengan validasi SSRF dan HTTPS. Sandbox tidak dapat mengakses key, database atau callback merchant live.

## Persyaratan data dan keamanan

- Jumlah token disimpan sebagai integer base units di database, bigint saat perhitungan, string pada JSON API; decimals diverifikasi dari mint allowlist.
- Uniqueness total payable berlaku lintas project untuk receiving address dan mint yang sama. Jangan memakai ulang nominal yang pernah diterbitkan secara otomatis.
- State paid, ledger dan event outbox ditulis atomik. Claim job memakai lease/recovery; dedup transfer dan handler idempotent wajib.
- Worker pemantau bersifat watch-only; kunci treasury tidak dibutuhkan untuk menerima pembayaran. Key test sender hanya untuk localnet.
- API key merchant disimpan sebagai hash, secret webhook dienkripsi, session cookie HttpOnly/Secure, CSRF protection untuk session mutations, rate limit dan RBAC.
- Satu receiving owner address per environment dengan dua ATA; saldo USDT/USDC terpisah. UI membedakan penerimaan bruto, invoice lunas, dan saldo aktual.

## Urutan implementasi

1. Bootstrap workspace, database migration, Compose localnet dan token fixture.
2. Invoice domain/API dengan idempotency dan alokasi nominal, lalu webhook inbox/outbox.
3. Watcher Solana, validasi transfer, finality, backfill dan rekonsiliasi.
4. Checkout dan playground yang menjalankan alur end-to-end localnet.
5. Dashboard, login admin, audit log dan penanganan pembayaran bermasalah.
6. Devnet integration dan pengujian browser mobile/desktop, lalu persiapan Azure.

Kriteria selesai tahap sandbox: satu perintah menyalakan layanan lokal; developer membuat invoice dari playground, membayar dengan mock token, menerima webhook dan melihat paid. Pembayaran salah nominal tidak auto-fulfill, restart tidak menggandakan transfer/event, dan sandbox tidak dapat mengubah order live.

## Referensi

- https://nextjs.org/docs/app/getting-started/installation
- https://fastify.dev/docs/latest/
- https://solana.com/docs/clients/official/javascript
- https://solana.com/docs/rpc
- https://faucet.circle.com/

Pembaruan implementasi: paket webhooks memakai node:http/https, DNS IP pinning, AES-256-GCM untuk secret dan antrean lease PostgreSQL. Aplikasi webhook-receiver menyediakan inbox merchant demo lokal dan fault controls; penggunaannya ada di [WEBHOOKS.md](WEBHOOKS.md).

Implementasi UI terbaru dan aturan komponen bersama: [UI-DESIGN.md](UI-DESIGN.md). Scalar adalah referensi/request explorer; playground pembayaran tetap alur khusus invoice → transaksi mock → checkout → webhook.
