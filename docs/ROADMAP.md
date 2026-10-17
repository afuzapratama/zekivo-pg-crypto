# Roadmap gateway pembayaran Zekivo

Tanggal awal: 17 Oktober 2026. Status terkini: Fase 0 selesai; Fase 1–6 berjalan dengan beberapa tugas terbuka; delivery webhook localnet terverifikasi. Pembayaran manual USDC dan Mock USDT Devnet sudah finalized → paid. Fondasi akses dashboard sedang berjalan; Azure staging dan Mainnet belum dimulai.

Dokumen ini menjadi checklist implementasi sampai produksi. Referensi: [riset](RESEARCH-USDT-GATEWAY.md) dan [stack](DEVELOPMENT-STACK.md). Jika riset lama berbeda dengan arah terbaru, gunakan scope roadmap ini dan keputusan stack. Setiap tugas diberi ID agar bisa dirujuk dalam issue, commit dan laporan progres.

## Scope versi pertama

- Solana saja; USDT dan USDC dengan mint resmi pada mainnet.
- Satu receiving owner address per environment, dua akun token/ATA; saldo aset terpisah.
- Checkout wallet memakai reference; transfer manual/exchange memakai nominal persis yang unik lintas project.
- Gateway internal beberapa website Zekivo, API merchant, checkout, dashboard dan dokumentasi/playground.
- Localnet untuk development tanpa dana asli, Devnet untuk integrasi, Mainnet untuk produksi.
- TypeScript, pnpm, Next.js, Fastify, PostgreSQL, Docker dan Azure sesuai dokumen stack.
- Receiving service watch-only. Tidak ada sweep per invoice atau private key treasury di aplikasi.

Di luar versi pertama: jaringan lain, alamat per invoice, bridge/swap otomatis, smart contract custom, merchant publik, payout/refund otomatis dan custody signing service. Refund dan pemindahan treasury pada awalnya merupakan proses operator di wallet terpisah dengan pencatatan/audit.

## Peta perjalanan

| Fase | Hasil utama                              | Dependensi                     | Status                              |
| ---- | ---------------------------------------- | ------------------------------ | ----------------------------------- |
| 0    | Kontrak perilaku dan kriteria penerimaan | Dua dokumen awal               | Selesai                             |
| 1    | Workspace dan Docker lokal berjalan      | 0                              | Berjalan                            |
| 2    | Database, invoice API dan nominal unik   | 1                              | Berjalan                            |
| 3    | Penerimaan pembayaran Solana localnet    | 2                              | Berjalan                            |
| 4    | Webhook andal dan merchant contoh        | 2; integrasi penuh setelah 3   | Delivery selesai; lifecycle terbuka |
| 5    | Checkout responsif                       | 2; integrasi penuh setelah 3–4 | Berjalan                            |
| 6    | Dokumentasi dan playground end-to-end    | 3–5                            | Berjalan                            |
| 7    | Dashboard dan operasional admin          | 2–4; fondasi auth dari 1       | Berjalan                            |
| 8    | Devnet dan verifikasi keandalan          | 3–7                            | Berjalan — USDC + Mock USDT paid    |
| 9    | Azure staging dan kesiapan operasi       | 8                              | Belum dimulai                       |
| 10   | Integrasi Zekivo dan pilot Mainnet       | 9                              | Belum dimulai                       |
| 11   | Peluncuran produksi dan observasi        | 10                             | Belum dimulai                       |

Urutan nomor adalah urutan delivery utama, bukan larangan menyiapkan komponen terkait lebih awal. Setiap fase menghasilkan software yang dapat didemonstrasikan atau bukti verifikasi; fase baru tidak menutupi kegagalan fase sebelumnya. Tidak menetapkan tanggal selesai sebelum kecepatan implementasi dan akses layanan diketahui.

## Status terkini dan urutan pekerjaan berikutnya

Ringkasan ini menjadi acuan pekerjaan saat ini; riwayat implementasi di bagian
akhir mempertahankan bukti dan konteks tahap sebelumnya.

| Area               | Sudah terbukti                                                                                                       | Yang belum selesai                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| F1 fondasi         | Workspace, Docker, validasi config, health, workflow CI tersedia                                                     | Remote CI dan OIDC/session                                                                               |
| F2 invoice/data    | Create/detail/list berfilter dan pagination, idempotency, exact amount, attempt switching, paid+ledger+outbox atomik | Transisi/review dan koreksi ledger lengkap                                                               |
| F3 scanner         | Finalized matching, dedup, pagination/checkpoint/overlap, retry baca RPC                                             | Confirming pra-finality, rekonsiliasi/failover/alert, recovery dan failure matrix lengkap                |
| F4 webhook         | Signed delivery/retry/replay dan merchant demo localnet                                                              | Lifecycle expired/partial/overpaid/late/review; versioning/race lengkap                                  |
| F5 checkout        | UI responsif, status API, copy/QR, asset switching dan browser QA                                                    | Kompatibilitas wallet URI/QR nyata, Safari/iOS, redaksi ingress/APM dan return URL                       |
| F6 docs/playground | Scalar, generate invoice, localnet mock payment, timeline/inbox dasar                                                | Replay/fault controls UI dan hosted sandbox dengan session/kuota                                         |
| F7 dashboard       | Login/session, overview counts/gross ledger, list/filter/pagination invoice, detail transaksi/event/delivery         | Verifikasi MFA/logout, saldo/checkpoint/lag, transfer global, review queue dan manajemen                 |
| F8 Devnet          | Isolasi layanan, USDC + Mock USDT manual paid, ledger/event terverifikasi                                            | Wallet payment link, connect/sign pembayaran playground, webhook HTTPS, reliability/load/security matrix |
| F9–11 operasi/live | Belum dimulai                                                                                                        | Azure, integrasi backend Zekivo, pilot mainnet, release dan observasi                                    |

Urutan implementasi berikutnya, sesuai arahan untuk menunda pengujian manipulasi:

1. **F2-04 — API daftar invoice (selesai):** filter status/aset, pagination stabil, detail/timeline yang dibutuhkan dashboard; tetap dibatasi project dan environment. Implementasi dan pengujian API selesai; fondasi dashboard berikutnya adalah langkah 2.
2. **F1-07c + F7-01/02 — fondasi dashboard:** Entra OIDC/session dan role admin/operator/read-only sebelum data operasional ditampilkan. Pengujian lokal tidak boleh membuat bypass login pada staging. Akses tenant/client/redirect Entra diperlukan untuk verifikasi login sebenarnya.
3. **F7-03/04/07 — dashboard baca:** overview, list/detail invoice/transfer, saldo, checkpoint dan status scanner; gunakan shadcn/ui yang sudah dipakai checkout/docs.
4. **F4-08/09 lalu F7-05/06 — operasional:** event lifecycle dan versioning, review queue, API key/endpoint management serta delivery/replay dengan audit. Koreksi/refund tetap harus memiliki bukti transfer dan hak akses.
5. **Tutup F5/6/8 yang terbuka:** wallet payment link/perangkat nyata, playground Devnet, inbox UI, HTTPS webhook, recovery dan beban. Keandalan scanner F3-05–09 tetap dilacak, tidak dianggap selesai oleh dashboard.
6. **Gate sebelum live:** F8-06–10 termasuk pengujian manipulasi dan verifikasi merchant, lalu staging Azure F9, integrasi/pilot Mainnet F10 dan produksi F11. Infrastructure staging dapat disiapkan paralel, tetapi promosi Mainnet menunggu gate tersebut lulus.

Pengujian manipulasi **dicatat dan ditunda dari sprint berikutnya**, bukan dihapus
atau menjadi penghambat pekerjaan dashboard lokal. Pengamanan akses dasar dan
pengujian scope pada fitur baru tetap bagian dari implementasi fitur tersebut.
Tidak ada deployment Azure/Mainnet yang dilakukan hanya karena roadmap diperbarui.

## Fase 0 — Tetapkan perilaku produk

Tujuan: menghilangkan ambiguitas yang dapat menyebabkan salah melunasi order.

- [x] F0-01 Tetapkan definisi invoice, payment attempt, transfer, settlement/ledger entry dan webhook event.
- [x] F0-02 Tetapkan state dan event: pending, confirming, paid, expired serta flag/review partial, overpaid, late dan unmatched. Bedakan finality transfer dari status invoice.
- [x] F0-03 Tetapkan expiry awal, batas tambahan nominal, precision input, aturan kode habis dan kebijakan nominal tidak dipakai ulang. Jangan mengubah total diam-diam saat pembayaran sedang berlangsung.
- [x] F0-04 Definisikan matching reference dan matching exact amount; reference valid tetap memerlukan mint, jumlah, penerima dan finality yang valid. Konflik/ambigu masuk review.
- [x] F0-05 Tetapkan kebijakan pemilihan aset: satu attempt per aset; pergantian aset mempertahankan attempt lama untuk deteksi late/double payment, tanpa dua kali fulfillment.
- [x] F0-06 Tetapkan kebijakan partial/multiple payments: MVP tidak otomatis menggabungkan transfer tanpa identitas invoice yang kuat; nominal tidak persis masuk review.
- [x] F0-07 Tetapkan harga stablecoin yang dikirim backend merchant sebagai sumber nominal MVP. Konversi fiat dan kurs otomatis ditunda; UI tidak menyebut USDT/USDC selalu persis bernilai USD.
- [x] F0-08 Tulis kontrak OpenAPI awal, format error, string amount, payload event, idempotency, pagination dan versioning.
- [x] F0-09 Buat matriks kriteria penerimaan dan daftar keputusan implementasi; kekurangan yang ditemukan dicatat sebagai perubahan scope.

Selesai jika: contoh order normal, expired, salah nominal, pergantian token dan pembayaran ganda memiliki hasil yang jelas; kontrak cukup untuk membangun merchant contoh tanpa menebak perilaku.

## Fase 1 — Fondasi repository dan lingkungan lokal

- [x] F1-01 Bootstrap pnpm workspace: apps/web, api, worker; packages/domain, database, solana, contracts, ui, config, testkit.
- [x] F1-02 Pin versi stabil yang kompatibel, Node LTS, package manager dan lockfile; aktifkan TypeScript strict, lint dan format.
- [x] F1-03 Buat Dockerfile multistage dan Compose untuk web, API, worker, PostgreSQL, validator lokal dan receiver webhook contoh.
- [x] F1-04 Buat validasi environment fail-fast dan pemisahan localnet/devnet/mainnet. Tidak boleh fallback jaringan otomatis.
- [x] F1-05 Buat seed idempotent: project sandbox, wallet lokal, mock USDT/USDC, dua ATA dan saldo test sender. Sediakan reset eksplisit hanya localnet.
- [x] F1-06 Implementasikan health/readiness, structured logs dan redaksi secret sejak awal.
- [ ] F1-07 Selesaikan fondasi CI dan identity; rincian di bawah (parent tetap terbuka).
- [x] F1-07a Konfigurasi workflow CI install frozen lockfile, lint, typecheck, test, build dan browser QA tersedia di `.github/workflows/ci.yml`.
- [ ] F1-07b Jalankan dan buktikan workflow pada remote repository; konfigurasi lokal bukan bukti remote CI lulus.
- [ ] F1-07c Implementasikan fondasi OIDC/session bersama F7-01; mock identity bila diperlukan hanya boleh aktif pada development eksplisit.
- [x] F1-08 Tulis quickstart .env.example, perintah start/stop/reset dan troubleshooting Docker.

Selesai jika: checkout bersih repository dapat menjalankan seluruh layanan lokal lewat perintah terdokumentasi, seed dapat diulang, dan CI lulus. Tidak membutuhkan seed treasury atau crypto asli.

## Fase 2 — Data pembayaran dan invoice API

- [x] F2-01 Buat migration untuk project, API key, invoice/attempt, reservation nominal, transfer, ledger, checkpoint, outbox/delivery dan audit.
- [x] F2-02 Gunakan integer base units, bigint untuk perhitungan, string pada JSON; validasi precision, batas dan overflow.
- [x] F2-03 Implementasikan hash API key, scope project, rate limit dan otorisasi setiap query.
- [x] F2-04 Implementasikan POST invoice, GET status/detail dan list dengan pagination. Token checkout acak membatasi data publik. List memiliki filter status/aset/order_id, cursor created_at+id, scope project/environment/cluster dan OpenAPI.
- [x] F2-05 Terapkan idempotency secara atomik; key sama+payload sama mengembalikan hasil sama, payload berbeda mendapat conflict.
- [x] F2-06 Alokasikan exact total unik dengan constraint DB lintas seluruh project pada environment+network+mint+recipient. Tangani concurrency, tabrakan lintas harga dasar dan kode habis.
- [x] F2-07 Buat reference unik dan histori attempt; worker expiry mempertahankan reservasi dan histori pembayaran.
- [ ] F2-08 Implementasikan transisi state serta ledger append-only dan outbox dalam transaksi DB. Koreksi menggunakan entry/transisi baru dengan audit.
- [x] F2-09 Uji request bersamaan, isolasi project, idempotency retry, digit nominal dan invoice expired.

Selesai jika: dua project dengan harga sama tidak mendapat total manual yang bertabrakan; retry tidak membuat invoice baru; secret tidak muncul di response publik/log.

## Fase 3 — Penerimaan Solana localnet

- [ ] F3-01 Implementasikan adapter RPC dan allowlist mint per environment, verifikasi decimals dan penerima/ATA milik receiving owner.
- [x] F3-02 Decode transaksi legacy/versioned yang didukung, account lookup dan instruksi token termasuk inner instructions; transaksi yang tidak dapat diparse tidak dianggap paid.
- [ ] F3-03 Simpan setiap transfer dengan identitas signature+instruction path, status eksekusi dan finality. Satu tx dapat memuat beberapa transfer.
- [x] F3-04 Implementasikan jalur reference dan exact amount sesuai Fase 0, dengan dedup global dan satu transfer maksimal satu alokasi invoice.
- [ ] F3-05 Terapkan confirming → paid setelah finalized; tangani observasi yang gagal/fork sebelum finality.
- [ ] F3-06 Buat scanner dengan pagination lengkap, cursor durable, overlap scan dan backfill saat restart. Cursor tidak boleh melewati rentang yang belum selesai diproses.
- [ ] F3-07 Buat rekonsiliasi berkala, retry/backoff RPC, failover endpoint dan alert jika scanner tertinggal. Subscription hanya akselerator, bukan satu-satunya sumber data.
- [ ] F3-08 Tulis test sender localnet untuk pembayaran tepat, salah token, kurang/lebih, tanpa reference, beberapa transfer dan transfer terlambat.
- [ ] F3-09 Uji crash/restart, scan ulang dan dua worker; ledger serta event tidak boleh terduplikasi.

Selesai jika: pembayaran mock USDT dan USDC masuk invoice yang benar setelah finalized; transfer palsu/salah nominal tidak melunasi order; downtime dapat dipulihkan tanpa kehilangan atau menggandakan pembayaran.

## Fase 4 — Webhook dan merchant contoh

- [x] F4-01 Implementasikan outbox dispatcher dan job claim dengan locking, lease serta recovery setelah worker mati.
- [x] F4-02 Tambahkan event_id tetap, versi payload, invoice version dan HMAC-SHA256 timestamp.rawBody; sign ulang setiap attempt.
- [x] F4-03 Implementasikan timeout, retry backoff+jitter, batas retry, dead-letter dan replay dengan event_id sama.
- [x] F4-04 Validasi URL endpoint HTTPS, alamat IP hasil resolusi, blok akses private/metadata, disable redirect dan batasi response body.
- [x] F4-05 Buat webhook inbox sandbox internal dan receiver merchant contoh yang memverifikasi raw body, timestamp dan signature.
- [x] F4-06 Receiver contoh mencatat event dan fulfillment atomik/idempotent; tangani event tidak berurutan dengan version/current invoice state.
- [x] F4-07 Uji timeout setelah merchant sudah commit, duplicate delivery, secret salah/rotasi, receiver mati dan replay.
- [x] F4-08 Kirim `payment.expired`, `payment.partial`, `payment.overpaid`, `payment.late` dan `payment.review_required` (reason duplicate/reference conflict) melalui outbox atomik. Hanya transfer dengan invoice teridentifikasi boleh menjadi event merchant; unmatched/ambigu tetap review internal.
- [x] F4-09 Terapkan invoice_version monoton pada seluruh transisi; identitas event mendukung beberapa kejadian review dalam satu invoice. Uji race expiry/payment, replay, event terbalik dan fulfillment tetap satu.
- [ ] F4-10 Setelah observasi sebelum finalized (F3-05) tersedia, tambahkan `payment.detected` untuk UX; tidak menjadi dasar fulfillment. RPC outage merupakan alert operasional, bukan payment.failed.

F4-01–07 menyelesaikan mekanisme delivery sandbox. F4-08–09 wajib sebelum produksi; F4-10 mengikuti dukungan confirming. Event refund mengikuti verifikasi refund manual F7-08; signing/refund otomatis tetap di luar scope v1.

Selesai jika: order contoh diproses sekali walaupun webhook diulang, kegagalan dapat dilacak dan dipulihkan; paid tidak bergantung pada keberhasilan webhook.

## Fase 5 — Checkout pembeli mobile dan desktop

- [x] F5-01 Bangun layout responsif dengan komponen aksesibel, status teks, fokus keyboard dan target sentuh nyaman.
- [x] F5-02 Tampilkan pilihan USDT/USDC, label Solana, exact total, penjelasan tambahan nominal, alamat, copy, QR dan countdown.
- [ ] F5-03 Implementasikan Solana Pay/payment link beserta reference dan mint; uji kompatibilitas wallet/SDK. Beri fallback transfer manual.
- [x] F5-04 Status berasal dari API/server; polling dengan backoff/reconnect cukup untuk MVP, dan redirect tidak boleh menjadi bukti paid.
- [x] F5-05 Buat tampilan pending, confirming, paid, expired dan pembayaran yang perlu diperiksa; jangan reset invoice saat halaman direfresh.
- [ ] F5-06 Terapkan redaksi checkout token pada log/analytics, kebijakan referrer dan validasi return URL merchant.
- [ ] F5-07 Uji browser mobile/desktop, clipboard gagal, wallet tidak terpasang, alamat panjang, refresh, offline/reconnect dan pergantian aset.
- [x] F5-07a Verifikasi browser Chromium desktop/mobile/320 px: layout/screenshot, keyboard, kontras axe, copy berhasil/gagal, QR decode, refresh, expiry, offline/online, wallet fallback dan error states. Bukti di CHECKOUT-QA.md.
- [ ] F5-07b Uji perangkat fisik/Safari/iOS dan aplikasi wallet sasaran pada Devnet; pemeriksaan URI/QR saja tidak membuktikan kompatibilitas wallet.
- [x] F5-07c Verifikasi pergantian aset dan race pembayaran attempt lama/baru setelah F2-07 selesai; total nominal berasal dari keputusan harga backend merchant.

Selesai jika: pembeli dapat menyelesaikan checkout di mobile/desktop dan status tetap benar setelah reload; frontend tidak dapat memaksa invoice menjadi paid.

## Fase 6 — Dokumentasi dan playground

- [x] F6-01 Buat /docs: quickstart, auth, invoice, amount/reference, finality, webhook, error dan sandbox/mainnet.
- [x] F6-02 Render OpenAPI dari kontrak yang sama dengan API; sertakan curl dan contoh receiver webhook.
- [x] F6-03 Buat /docs/playground dengan input project sandbox, token, harga, order ID dan expiry; tampilkan request/response tersanitasi.
- [x] F6-04 Tambahkan tombol generate invoice, buka checkout, copy QR/alamat dan timeline payment/webhook.
- [x] F6-05 Localnet: tombol kirim mock token tepat/kurang/lebih memakai testkit. Endpoint helper tidak tersedia pada live deployment.
- [ ] F6-06 Tambahkan webhook inbox, inspect payload, hasil validasi signature, retry/replay dan simulasi merchant gagal.
- [x] F6-07 Pisahkan label Simulation bila tersedia dari transaksi blockchain lokal; jangan menampilkan tx/finality fiktif sebagai transaksi nyata.
- [ ] F6-08 Playground hosted memakai session/project sandbox terisolasi dan kuota; kredensial merchant disimpan server-side. Gunakan inbox internal sebagai default.
- [x] F6-09 Buat Playwright end-to-end invoice → mock transfer → finalized → webhook → merchant fulfilled. Dua aset localnet lulus; pembuatan invoice melalui API di test runner, bukan playground UI yang belum dibuat.

Selesai jika: developer baru dapat menguji seluruh alur dari dokumentasi tanpa crypto asli; sandbox tidak mengubah database/order/endpoint merchant live.

**Milestone A (target, belum seluruhnya selesai): MVP lokal dapat didemonstrasikan.** Jalur pembayaran dan webhook lokal sudah terbukti; seluruh tugas Fase 1–6 tetap harus ditutup untuk menyatakan milestone lengkap.

## Fase 7 — Dashboard management

- [ ] F7-01 Selesaikan Entra OIDC login, MFA melalui identity provider, session HttpOnly/Secure, CSRF protection dan logout. Batasi tenant/identitas admin yang diizinkan.
- [ ] F7-02 Buat role admin/operator/read-only dan audit untuk seluruh perubahan sensitif; autentikasi ulang untuk aksi berisiko.
- [ ] F7-03 Overview per token/project/environment: invoice paid, pending/review, penerimaan bruto dan saldo wallet ditampilkan sebagai metrik berbeda.
- [x] F7-03a Overview seluruh periode, filter project, counts paid/pending/confirming/expired/review, penerimaan bruto per aset dari kredit ledger; saldo wallet tetap F7-07, bukan angka penerimaan.
- [x] F7-04a Daftar invoice admin berfilter project/status/aset/order, cursor pagination, tabel desktop/kartu mobile, session + permission server-side dan scope environment/cluster.
- [x] F7-04b Detail invoice/attempt, transfer finalized, timeline event dan delivery webhook aktual; link explorer sesuai cluster, histori 100 item terbaru dengan penanda truncation.
- [x] F7-04c Daftar transfer global dengan filter/pagination, signature persis, rincian/Explorer/invoice/review serta pagination independen histori detail >100 item.
- [x] F7-04 Daftar/detail invoice dan transfer dengan filter, pagination, timeline dan link explorer sesuai cluster.
- [x] F7-05 Review queue untuk unmatched/partial/overpaid/late dan pembayaran ganda; catat alasan, bukti dan operator. Jangan membuat tombol bebas mark paid tanpa transfer tervalidasi.
- [x] F7-06a Halaman daftar/detail project dan create project internal, nama integrasi website/app serta scope environment; bukan pengelolaan tenant perusahaan baru.
- [x] F7-06b Generate/revoke API key bernama, prefix/status/tanggal, tampil lengkap sekali, hash di DB, pagination history, request idempotent, permission admin+CSRF+fresh auth dan audit actor atomik.
- [x] F7-06c Dashboard webhook: register endpoint HTTPS, rotation signing secret, delivery log dan replay admin dengan audit dan permission; gunakan mekanisme delivery/SSRF merchant yang sudah ada.
- [x] F7-06 Project management, create/revoke/rotate API key, webhook endpoint/secret rotation, delivery log dan replay terotorisasi.
- [x] F7-07a Receiving owner, ATA/mint, saldo USDT/USDC finalized, checkpoint/waktu update, head dan lag slot pada dashboard; validasi jaringan/token/owner, cache snapshot 15 detik, status unknown/unavailable tanpa saldo nol palsu.
- [x] F7-07b1 Notifikasi internal SMTP/Telegram: kanal terenkripsi lewat admin, antrean persisten, waiting configuration, retry/TTL/log, pesan uji eksplisit, alert confirmed/review/webhook dead/scanner dan mode Mailpit lokal.
- [x] F7-07b2a Rekonsiliasi snapshot invoice/ledger/event dan verifikasi ulang maksimal 10 bukti transfer paid finalized per run, hasil/temuan/cursor/lease persisten serta alert incident.
- [x] F7-07b2b Service monitor terpisah dari worker, cek identitas/liveness API dan heartbeat scanner, deduplikasi/cooldown/recovery serta dispatcher notifikasi independen dari worker utama.
- [ ] F7-07b2c Uptime dari luar host/DB (Azure), heartbeat monitor hilang, serta baseline/rescan seluruh incoming/outgoing untuk coverage treasury; belum dicakup verifikasi batch paid.
- [ ] F7-07b2 Rekonsiliasi terjadwal dengan bukti selisih ledger/chain dan uptime monitor independen ketika seluruh worker mati; kanal alert bukan pengganti pekerjaan ini.
- [ ] F7-07b3 Email bukti bayar pembeli: kontrak email/consent per project, template/resend/deduplikasi dan SPF/DKIM/DMARC; hanya setelah payment confirmed. Invoice saat ini belum mengumpulkan email pembeli.
- [ ] F7-07b Rekonsiliasi terjadwal, status job gagal dan alert otomatis; indikator checkpoint tidak dianggap heartbeat proses worker atau verifikasi seluruh histori.
- [ ] F7-07 Tampilkan receiving address, saldo USDT/USDC, checkpoint, lag RPC, job gagal dan status rekonsiliasi. Private key tidak ditampilkan.
- [x] F7-08 Sediakan pencatatan refund manual dengan tujuan terverifikasi, tx signature dan audit; status refund confirmed diverifikasi terhadap chain.
- [ ] F7-08a Perluas refund ke transfer unmatched/partial/extra overpayment, request/approval sebelum kirim, ledger debit dan refund webhook. Uji wallet refund Devnet dilewati atas arahan operator.
- [ ] F7-09 Uji akses lintas project/role dan layout kartu mobile/tabel desktop. Export bila diperlukan harus mengikuti scope dan redaksi data.

Selesai jika: operator dapat menelusuri dan menangani pembayaran bermasalah serta webhook gagal dengan audit yang lengkap dan hak akses teruji.

## Fase 8 — Devnet dan pengujian keandalan

- [x] F8-00 Tulis kebutuhan dan gap provision Devnet dari sumber issuer/Solana; checklist di DEVNET.md. Ini belum berarti layanan Devnet aktif.

- [x] F8-01 Siapkan Devnet terpisah: receiving wallet, USDC faucet, mint Mock USDT yang jelas, database/secret/API key sendiri.
- [x] F8-01a Provision USDC Circle Devnet: DB/project/key terpisah, owner/ATA/genesis/mint terverifikasi, batas awal scanner diaudit sebelum invoice, dan layanan Docker loopback terpisah.
- [x] F8-01b Provision mint Mock USDT Devnet berlabel jelas dan canonical ATA kedua; jangan memakai signer fixture localnet.
- [ ] F8-02 Tambahkan connect wallet devnet di playground; transaksi ditandatangani wallet pengguna, tidak meminta seed.
- [ ] F8-03 Uji payment link/QR pada wallet sasaran, mint/ATA verification, precision dan perbedaan localnet/devnet.
- [x] F8-03a Pembayaran manual USDC Devnet dari Phantom operator: finalized, checkout paid, satu kredit ledger dan satu event confirmed. Ini belum memverifikasi Solana Pay/reference atau delivery webhook HTTPS.
- [x] F8-03b Pembayaran manual Mock USDT Devnet dari Phantom: finalized slot 511955651, invoice paid/version 2, satu kredit ledger dan satu event confirmed. Token uji proyek; bukan USDT resmi Tether.
- [ ] F8-04 Uji RPC unavailable/rate limit, failover, backlog, worker restart, fork/finality fixture, DB outage dan event tidak berurutan.
- [ ] F8-05 Uji beban awal: 100 invoice dibuat bersamaan, burst transfer yang terkontrol dan backlog webhook; ukur latency, error, collision, lag dan pemulihan. Angka ini target test, bukan jaminan throughput produksi.
- [ ] F8-06 Jalankan pemeriksaan dependency/secret, validasi input, SSRF, XSS/CSRF, otorisasi dan sandbox isolation.
- [ ] F8-07 Bekukan kontrak v1 dan perbaiki semua temuan yang dapat menyebabkan kehilangan pembayaran, salah match, kebocoran secret atau fulfillment ganda.
- [ ] F8-08 Uji manipulasi pembayaran sebelum production: token/mint palsu, SOL atau aset lain, transaksi gagal, signature lama/duplikat, nominal/reference/penerima berbeda, dua worker dan pembayaran bersamaan. Tidak boleh menghasilkan kredit atau paid yang tidak sah.
- [ ] F8-09 Uji pemalsuan/replay webhook dan fulfillment merchant: HMAC raw body, freshness timestamp, project/order/invoice/aset/nominal sesuai pesanan backend, dedup event dan satu fulfillment. Perubahan browser/redirect tidak menjadi bukti paid.
- [ ] F8-10 Evaluasi dan implementasikan konfirmasi pembayaran melalui RPC independen untuk production: pin cluster/mint/penerima, tangani provider berbeda hasil atau tertinggal, jangan melunasi saat verifikasi tidak meyakinkan. Bedakan dari failover operasional F3-07.

Selesai jika: matriks USDT mock/USDC, reference/manual dan failure recovery lulus; bukti hasil beserta keterbatasan mainnet terdokumentasi.

**Milestone B: release candidate terverifikasi di Devnet.** Tidak menyatakan mock USDT setara seluruh perilaku USDT resmi.

## Fase 9 — Azure staging dan kesiapan operasi

- [ ] F9-01 Inventaris akses Azure, subscription/kredit/expiry, region, domain, Entra tenant dan RPC provider. Periksa kebutuhan aktual tanpa mengubah pilihan produk inti.
- [ ] F9-02 Buat infrastructure as code (Bicep): Container Apps web/API/worker, registry image, PostgreSQL, Key Vault, monitoring dan storage jika diperlukan.
- [ ] F9-03 Terapkan managed identity, least privilege, TLS, akses database terbatas dan secret injection; worker kontinu tidak scale-to-zero.
- [ ] F9-04 Pisahkan staging Devnet dan produksi Mainnet pada resource/config/DB/secret. Implementasikan assertion cluster+mint+recipient sebelum layanan siap.
- [ ] F9-05 Buat pipeline image immutable, migrations sebagai job terkontrol, deploy staging, smoke test dan prosedur promosi release.
- [ ] F9-06 Gunakan migration backward-compatible, backup sebelum perubahan berisiko dan runbook rollback; rollback aplikasi tidak boleh menghapus histori pembayaran.
- [ ] F9-07 Konfigurasi backup/PITR dan lakukan restore drill ke database terisolasi. Setelah restore, backfill chain dan rekonsiliasi outbox dengan merchant agar event/fulfillment tidak berganda.
- [ ] F9-08 Set alert lag scanner, RPC/DB gagal, webhook dead-letter, review queue dan biaya; batasi retensi log dan tetapkan operator penerima alert.
- [ ] F9-09 Tetapkan target operasi awal: alert scanner tertinggal lebih dari 2 menit, target pemulihan layanan 4 jam dan target kehilangan data DB maksimal 15 menit. Verifikasi dukungan konfigurasi backup dan hasil drill; pembayaran chain harus dapat di-backfill, sedangkan invoice/reservasi harus dipulihkan dari DB. Target bukan SLA pelanggan sebelum terbukti.
- [ ] F9-10 Tulis runbook RPC outage, database recovery, webhook outage, key rotation, unmatched payment, refund manual dan pause invoice baru. Pemantauan dana masuk tetap berjalan saat checkout dipause.
- [ ] F9-11 Hitung biaya SKU/region nyata dan RPC, set budget alert, cek expiry kredit; jangan menganggap estimasi riset sebagai tagihan final.

Selesai jika: staging berjalan melalui pipeline, restore/rollback pernah dicoba, alert dapat diterima operator dan seluruh secret produksi terpisah. Infrastruktur belum berarti gateway boleh menerima order live.

## Fase 10 — Integrasi Zekivo dan pilot Mainnet

- [ ] F10-01 Implementasikan adapter pada backend Zekivo: harga server-side, external order ID, invoice creation idempotent dan checkout redirect.
- [ ] F10-02 Implementasikan webhook receiver Zekivo dengan signature verification, event dedup dan fulfillment atomik; sediakan rekonsiliasi status dari gateway.
- [ ] F10-03 Uji di staging Zekivo dengan sandbox: abandoned checkout, refresh, duplicate/out-of-order webhook dan pembayaran ganda dua aset.
- [ ] F10-04 Siapkan receiving owner Mainnet dengan operator; verifikasi alamat melalui kanal tepercaya, mint resmi dan dua ATA. Simpan recovery material treasury offline; aplikasi hanya menerima public address.
- [ ] F10-05 Verifikasi konfigurasi Mainnet dari sumber issuer saat pelaksanaan, gunakan RPC produksi dan lakukan pemeriksaan address/token pada startup.
- [ ] F10-06 Jalankan pilot Mainnet bernilai kecil secara terencana dengan wallet operator dan USDT/USDC resmi. Ini verifikasi akhir, bukan kebutuhan development lokal; transfer memakai dana nyata dijadwalkan bersama operator pemilik dana.
- [ ] F10-07 Uji satu alur reference dan satu manual exact amount, webhook Zekivo serta fulfillment; cek bahwa satu pembayaran hanya menghasilkan satu order selesai.
- [ ] F10-08 Catat actual fee, finality, RPC lag dan compatibility. Bila exchange sasaran tersedia, uji pembulatan/withdrawal fee dengan nominal kecil, tanpa menganggap semua exchange identik.
- [ ] F10-09 Verifikasi pencatatan transfer treasury/refund manual dan prosedur penanganan pembayaran terlambat; tidak mengaktifkan signing server.

Selesai jika: Zekivo berhasil menerima USDT dan USDC asli dalam pilot, seluruh transaksi/ledger/webhook dapat direkonsiliasi, dan tidak ada temuan kritis terbuka. Jika akses repository/backend Zekivo belum tersedia, adapter contoh disiapkan lebih dahulu dan integrasi live tetap dicatat belum selesai.

## Fase 11 — Peluncuran produksi dan observasi

- [ ] F11-01 Selesaikan checklist rilis di bawah dan catat commit/image/config/migration yang dipromosikan.
- [ ] F11-02 Aktifkan checkout untuk traffic terbatas dengan batas nilai invoice dan monitoring intensif; batas numerik ditetapkan berdasarkan hasil pilot.
- [ ] F11-03 Pantau sedikitnya 7 hari dan kumpulkan bukti minimum satu pembayaran tiap aset, kedua jalur matching, serta retry webhook terkendali. Jika transaksi organik sedikit, gunakan pilot operator; waktu berlalu saja bukan bukti lulus.
- [ ] F11-04 Rekonsiliasi harian invoice, transfer final, ledger, saldo dengan memperhitungkan transfer keluar, dan status fulfillment Zekivo.
- [ ] F11-05 Jika salah match/fulfillment ganda/isolation gagal, pause invoice baru, lanjutkan scanner dan penanganan order berjalan; rollback menggunakan runbook.
- [ ] F11-06 Perluas traffic setelah hasil pilot/observasi diterima dan tidak ada selisih tanpa penjelasan atau temuan kritis.
- [ ] F11-07 Tutup release v1 dengan catatan biaya aktual, kapasitas, hasil recovery dan backlog prioritas berikutnya.

Selesai jika: pembayaran produksi USDT/USDC dapat digunakan di Zekivo, operator mampu mendeteksi dan memulihkan gangguan, serta dokumentasi integrasi/operasi sesuai perilaku aplikasi.

**Milestone C: production v1 digunakan dan terpantau.**

## Checklist wajib sebelum traffic produksi

- [ ] Invoice dan nominal unik aman terhadap concurrency, retry, expiry serta pembayaran terlambat.
- [ ] Mint, penerima, nominal, status eksekusi dan finalized diverifikasi server-side.
- [ ] Transfer/ledger/outbox/fulfillment tidak mengganda setelah retry atau restore.
- [ ] API key, session, secret webhook, tenant/role dan sandbox isolation teruji.
- [ ] Endpoint helper test tidak tersedia pada live; seed/private key treasury tidak ada pada workload.
- [ ] Checkout dan dashboard lulus uji mobile/desktop serta alur error/reconnect.
- [ ] Zekivo backend menghitung harga dan memverifikasi webhook, tanpa mempercayai redirect browser.
- [ ] Backfill, RPC failover, restore, rollback, pause checkout dan alert sudah dicoba.
- [ ] Mainnet pilot USDT/USDC resmi lulus, saldo/ledger/order dapat direkonsiliasi.
- [ ] Operator, akses layanan, recovery wallet, budget dan dokumentasi operasional siap.

## Cara memelihara roadmap

Centang tugas hanya setelah artefak atau bukti pemeriksaannya tersedia. Saat mulai sebuah fase, ubah status tabel menjadi Berjalan; sesudah seluruh kriteria terpenuhi menjadi Selesai dan tambahkan tanggal serta ringkasan hasil. Tugas yang tertunda tetap terbuka dengan alasan/dependensi, bukan dianggap selesai karena UI sudah tersedia. Catat perubahan keputusan di bawah agar scope tidak bergeser tanpa terlihat.

| Tanggal    | Keputusan/perubahan                                                             | Dampak                                                                             |
| ---------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 2026-10-17 | Roadmap awal mengikuti satu alamat Solana, USDT/USDC, watch-only dan playground | Menggantikan tahapan multi-chain/alamat unik/sweep pada riset awal untuk scope v1. |

## Backlog sesudah v1

Prioritaskan berdasarkan penggunaan nyata: peningkatan UX exchange/precision, laporan/export akuntansi, tambahan website internal, peningkatan HA dan performa, serta otomasi refund/payout dengan desain custody terpisah. Jaringan baru atau alamat per invoice memerlukan keputusan arsitektur baru; tidak dimasukkan diam-diam ke fase yang sedang berjalan.

## Riwayat implementasi — 17 Oktober 2026

Catatan di bawah adalah snapshot kronologis saat pekerjaan berlangsung. Pernyataan “belum tersedia” atau “pending” pada snapshot lama tidak menggantikan checklist utama dan ringkasan status terkini di atas.

### Fondasi awal

- Fase 0: kontrak dan matriks penerimaan tersedia di [PAYMENT-CONTRACT.md](PAYMENT-CONTRACT.md). OpenAPI awal dihasilkan melalui `/openapi.json`; beberapa fitur kontrak ditandai untuk fase lanjutan.
- Fase 1 parsial: workspace, lockfile, Next.js, Fastify, worker expiry, migration/seed database, health/readiness, logging, lint/typecheck/test/build dan pipeline CI dibuat. CI tersedia sebagai konfigurasi; belum dijalankan pada GitHub.
- F1-03 belum selesai: Compose aplikasi/database tersedia, tetapi validator dan receiver webhook belum ada.
- F1-05 belum selesai: seed project/API key lokal idempotent tersedia; wallet/mint/ATA fixture belum ada.
- F1-07 belum selesai: pipeline pemeriksaan tersedia; OIDC/session belum diimplementasikan.
- Fase 2 parsial: POST/GET invoice, API key hash+project scope, rate limit dasar per instance, reservasi nominal historis dan idempotency menggunakan transaksi/constraint PostgreSQL. Nominal foundation memakai placeholder recipient/mint, bukan alamat pembayaran.
- F2-01/04/07/08 tetap terbuka: schema attempt/transfer/ledger/outbox, list pagination, reference dan payment state machine penuh belum ada. Expiry worker hanya menangani invoice pending; belum menghasilkan webhook.
- Pengujian lokal: 16 test lulus dengan PostgreSQL nyata, mencakup request bersamaan lintas project, retry paralel, isolasi project, validasi nominal dan reservasi invoice expired. Build awal web/API/worker, lint dan typecheck lulus.
- Port lokal: web 3100, API 4100 dan PostgreSQL 55432. Port standar sudah dipakai proyek lain; layanan tersebut tidak diubah.
- Halaman web baru halaman status development. Checkout, dashboard dan playground belum diimplementasikan. `payment_enabled=false`; konfigurasi production/mainnet ditolak.

Langkah berikutnya: selesaikan validator/mock token fixture dan kontrak adapter Solana, lalu implementasikan attempt/reference, transfer ledger dan watcher sebelum mengaktifkan checkout pembayaran.

Verifikasi Docker lokal: build image development berhasil; migration dan seed selesai dengan exit 0; web 3100, health/readiness API 4100 dan OpenAPI merespons HTTP 200. POST invoice melalui HTTP memberi 201 dan replay memberi 200 dengan ID/nominal sama. Pemeriksaan UI terbatas pada build dan HTTP; belum ada pengujian browser visual. Container pemeriksaan dihentikan setelah verifikasi, volume database dipertahankan.

## Catatan implementasi lanjutan — localnet Solana

- Validator resmi Agave 4.3.2 berjalan dengan ledger persisten, versi/checksum terkunci dan port RPC 8899. Linux/amd64; Agave 4 memerlukan io_uring sehingga hanya container validator lokal menggunakan seccomp unconfined, no-new-privileges dan cap_drop ALL. API/worker tidak memakai pengecualian ini.
- F1-05 selesai: signer fixture lokal deterministik, mock mint USDT/USDC 6 decimals, satu receiving owner dengan dua ATA dan sender berisi SOL/token test. Seed memeriksa genesis dan tidak menghapus invoice/saldo penerima. Private key fixture tidak diimpor oleh proses API/worker.
- Migration 002 menambahkan token config, reference invoice, transfer, ledger, event outbox dan checkpoint. Invoice lama ber-placeholder tetap disabled; invoice baru aktif hanya setelah pemeriksaan chain lulus.
- API readiness dan pembuatan invoice aktif memverifikasi genesis, token program, mint decimals, owner dan canonical ATA. Invoice aktif menyertakan recipient, mint dan reference.
- Watcher memproses finalized parsed SPL transfer legacy/versioned v0, termasuk inner instructions. Matching reference/exact amount, duplicate/partial/overpaid/late/conflict review, ledger dan payment.confirmed outbox ditulis atomik. Satu transfer tidak dikredit dua kali.
- Scanner memiliki pagination, cursor durable dan session lock per akun. Null transaction/RPC failure menghentikan kemajuan cursor. Pemeriksaan genesis mencegah melanjutkan histori lama pada ledger baru. Full periodic reconciliation, overlap/backfill audit, endpoint failover, alert lag dan dukungan confirming real-time masih belum selesai.
- CLI tersedia: local:seed-chain, local:pay dan local:smoke; helper hanya menerima local/localnet dengan endpoint RPC lokal. Checkout, dashboard dan playground masih belum tersedia.
- Bukti verifikasi: 31 test unit/integrasi PostgreSQL lulus, typecheck/lint/format/build berhasil. Smoke dengan transaksi validator nyata meluluskan USDT+reference, USDC+manual amount dan partial payment. Scan ulang tidak menggandakan ledger/event.
- Event outbox sudah tersimpan tetapi belum ada webhook dispatcher/signature/retry/receiver. Fase 4 belum dinyatakan selesai.
- Fase 2 masih parsial: belum ada payment attempt switching, list pagination, ledger correction workflow dan seluruh event lifecycle. Fase 3 juga belum ditandai selesai hanya karena jalur paid sudah berjalan.

Verifikasi container lanjutan: Compose berhasil menjalankan validator, migration, seed project, seed chain, API, worker dan web tanpa reset volume. Readiness API lulus validasi token/ATA/genesis. Uji HTTP membuat invoice USDC aktif, menghentikan worker, mengirim mock token hingga finalized, memastikan status masih pending saat worker mati, lalu menghidupkan worker kembali. Invoice otomatis paid setelah backfill dengan tepat satu ledger entry dan satu outbox event. Container milik proyek tetap berjalan sesuai sesi development pengguna. Uji ini memverifikasi recovery worker, bukan mengklaim full disaster recovery atau webhook delivery sudah selesai.

## Perbaikan checkpoint setelah pengujian pengguna — 17 Oktober 2026

- Penyebab terverifikasi: validator memangkas histori lama; `until` menunjuk signature checkpoint yang sudah tidak tersedia. Ini membuat worker dan smoke terus gagal walaupun chain/genesis tetap sama.
- Migration 003 menambahkan watermark slot dan audit gap histori; tidak menghapus invoice, ledger atau reservasi nominal. Scanner memakai pagination `before` tanpa `until`, memproses overlap 32 slot, dan memperbarui cakupan finalized juga saat akun idle.
- Recovery histori tersisa hanya diizinkan local/localnet dengan audit gap permanen. Lingkungan lain berhenti jika ada gap dan membutuhkan RPC lengkap/archive. Kegagalan lookup/pagination tidak memajukan checkpoint.
- Smoke kini menunggu transfer spesifiknya tercatat ketika lock dipegang worker, menggunakan snapshot accounting konsisten dan memeriksa idempotency setelah replay.
- Verifikasi: 40 test unit/integrasi PostgreSQL lulus; lint, typecheck dan build lulus. Transaksi percobaan pengguna yang sebelumnya tertahan berhasil menjadi paid dengan satu ledger entry dan satu outbox event. Reset database/ledger tidak dilakukan.

## Fase 4 selesai — delivery webhook sandbox, 17 Oktober 2026

- Migration 004 menambahkan endpoint dengan secret AES-256-GCM, delivery queue, attempt history serta tabel merchant demo. API merchant dapat register/list endpoint, rotate secret eksternal, melihat delivery/attempt dan replay dengan project isolation serta audit.
- Dispatcher menggunakan lease 45 detik, row locking SKIP LOCKED dan token fencing. HTTP deadline 10 detik, backoff+jitter maksimal 1 jam dan dead-letter setelah cycle 24 jam. Replay mempertahankan event_id/payload, history dan fulfillment idempotent.
- Target eksternal HTTPS port 443 diverifikasi melalui DNS setiap attempt, seluruh alamat harus publik, koneksi dipin ke IP tervalidasi dengan Host/SNI/TLS asli. Redirect tidak diikuti dan body response dibatasi. Pengecualian HTTP hanya untuk fixture local inbox; API publik tidak menerima pengecualian tersebut.
- Loop dispatcher terpisah dari watcher agar endpoint merchant lambat tidak memblokir penerimaan pembayaran.
- Receiver demo memakai raw-body HMAC, freshness 300 detik, receipt dedup dan perubahan order atomik; event usang tidak menurunkan order paid. Fault controls/inbox hanya pada receiver lokal dengan token fixture.
- Compose menyediakan receiver pada port host 4200, menjalankannya setelah migration dan sebelum seed endpoint lokal. Validator, database dan data pembayaran pengguna tetap dipertahankan.
- Verifikasi: 75 test unit/integrasi PostgreSQL lulus, typecheck/lint/build berhasil. Docker HTTP smoke lulus untuk USDT normal + replay, USDC manual dengan timeout setelah merchant commit + retry + replay; fulfillment tetap satu. Riwayat attempt benar-benar mencatat timeout lalu HTTP 200.
- Event otomatis saat ini hanya payment.confirmed. Lifecycle event lainnya, versioning semua transisi, checkout, dashboard dan backend Zekivo asli masih tugas fase masing-masing. Selesainya fase delivery tidak berarti seluruh gateway siap produksi.

Panduan: [WEBHOOKS.md](WEBHOOKS.md). Perintah uji: `docker compose exec api pnpm local:webhook-smoke`. Tahap berikutnya adalah Fase 5 checkout responsif, kemudian Fase 6 dokumentasi/playground interaktif; tugas terbuka Fase 1–3 tetap dilacak.

Verifikasi tambahan Fase 4: receiver benar-benar dihentikan saat replay delivery. Attempt gagal tercatat, kemudian receiver dihidupkan kembali dan retry berhasil; event/receipt/fulfillment tetap satu. Receiver/API/worker/web tetap berjalan setelah verifikasi.

## Fase 5 dimulai — checkout sandbox

- Checkout `/pay/<token>` memiliki layout mobile/desktop, fokus keyboard, status live, nominal persis, rincian aset/jaringan, alamat/mint, copy fallback, QR dan URI Solana Pay. Tidak menggunakan aset eksternal atau analytics.
- Public read API `/v1/checkout` membatasi proyeksi invoice melalui token acak 256-bit, environment dan cluster. Tidak mengekspos order/project/API key; token tidak dapat memanggil API merchant atau mengubah status. Proxy same-origin memakai API_INTERNAL_URL server-side, tanpa merchant key pada browser.
- Polling memakai timeout, abort saat unmount dan retry backoff; countdown menggunakan waktu server. Instruksi kirim disembunyikan saat offline, expired, confirming, paid, disabled atau review. Polling invoice expired tetap berjalan untuk pembayaran tepat waktu yang baru diindeks.
- F5-02 parsial: aset masih tetap sesuai invoice; pilihan/pergantian USDT/USDC menunggu attempt history F2-07. F5-03 parsial: URI/QR mengikuti spesifikasi Solana Pay, tetapi kompatibilitas wallet nyata belum diuji. Cluster harus dipilih pada wallet; URI tidak otomatis memindahkan wallet ke localnet.
- F5-06 parsial: header token pada API direduksi dari log, no-store/no-referrer/noindex/frame denial tersedia; redaksi URL checkout pada ingress/APM/log Next serta return URL allowlist belum selesai. Tidak ada fitur redirect/return URL saat ini.
- F5-07 tetap terbuka: belum ada verifikasi browser visual mobile/desktop, clipboard, wallet, refresh/offline dan asset switching. Build/HTTP check tidak menggantikan browser QA.
- Lifecycle webhook lanjutan dicatat sebagai F4-08–10. F4-08–09 wajib sebelum produksi; payment.detected bergantung observasi sebelum finalized, refund event mengikuti F7-08.

Verifikasi: 76 test unit/integrasi PostgreSQL lulus; typecheck, lint, format dan build berhasil. Smoke HTTP Docker membuka checkout, membaca proyeksi via proxy, menolak token salah, mengirim USDC manual hingga paid (`2a443338-80b1-4c05-aa4d-24bd9780595b`) dan USDT kurang ber-reference hingga review partial (`3a28bada-43be-45bf-ac1d-94f90515b526`). Uji memakai token mock; tidak mereset database/ledger. Ini verifikasi HTTP/API/chain, bukan browser visual.

Panduan: [CHECKOUT.md](CHECKOUT.md). Fase 5 tetap Berjalan; dashboard dan playground belum tersedia.

## Fase 5 lanjutan — QA visual dan interaksi checkout

- F5-07a selesai: 30 test browser Chromium lulus pada 1440×1000, 390×844 dan 320×740. Screenshot diperiksa langsung; tidak ada horizontal overflow, alamat/mint tetap terbaca. Audit axe pada pending tidak menemukan pelanggaran WCAG A/AA yang diperiksa; tidak dianggap audit aksesibilitas menyeluruh.
- Temuan diperbaiki: markup/nama aksesibel tombol copy, target sentuh 44 px, kontras caption/footer dan posisi QR mobile. Rincian invoice mobile dapat dilipat; desktop tetap terbuka. Timer tidak diumumkan screen reader setiap detik.
- Polling kini memakai timer monoton, mengurangi durasi request, mengabaikan response request yang dibatalkan, menyembunyikan instruksi segera saat offline dan meminta status baru ketika online/tab aktif. Kegagalan QR, clipboard dan link wallet tetap memiliki jalur manual.
- Next development tidak mencatat path checkout pada incoming request log, browser console forwarding dimatikan. Pemeriksaan log pada pengujian chain tidak menemukan token URL. Redaksi ingress/APM tetap perlu dibuktikan saat deployment; F5-06 belum dinyatakan selesai seluruhnya.
- F6-09 selesai pada localnet: dua test browser+chain lulus, USDT reference dan USDC manual. Setelah pembayaran finalized, halaman paid bertahan setelah reload; receiver memverifikasi signature dan fulfillment tepat satu kali. Browser tidak menerima API key/control token.
- Verifikasi lain: 76 test unit/integrasi PostgreSQL, typecheck/lint/build lulus. Pipeline CI menambahkan instalasi Chromium serta suite fixture UI; belum dijalankan pada remote GitHub. Browser test dibatasi loopback dan test chain menolak environment selain local/localnet.
- F5-02/03/06/07 tetap parsial sesuai dependensinya. Wallet nyata/Devnet, Safari/perangkat fisik dan asset switching tidak dicentang hanya karena UI fixture lulus. Fase 5 tetap Berjalan; fase docs/playground belum dimulai meskipun test F6-09 disiapkan lebih awal.

Bukti dan screenshot: [CHECKOUT-QA.md](CHECKOUT-QA.md). Jalur pekerjaan berikutnya: model attempt/history F2-07 untuk pemilihan aset checkout, dilanjutkan penyelesaian Fase 5 dan dokumentasi/playground Fase 6. Lifecycle webhook F4-08–09 tetap menjadi gate sebelum produksi.

## Penyelesaian pemasangan checkout Docker

- Image web terbaru sudah dipasang pada service Compose web port 3100 tanpa restart API/worker/validator/database dan tanpa reset data.
- Smoke browser pada container menemukan Next development memblokir origin 127.0.0.1, sehingga hydration tertahan pada layar memuat. Konfigurasi allowedDevOrigins kini mengizinkan tambahan loopback 127.0.0.1 dan IPv6 loopback saja; tidak memakai wildcard origin publik.
- Setelah perbaikan, enam pemeriksaan browser pada Docker lulus: layout/keyboard/axe dan decode QR untuk desktop 1440 px, mobile 390 px serta 320 px. Typecheck, lint dan build setelah perubahan konfigurasi juga lulus.
- Artefak test-results/playwright-report tidak dimasukkan ke image melalui dockerignore. Container layanan tetap berjalan; Fase 5 masih Berjalan dengan pekerjaan attempt/history dan wallet nyata yang belum selesai.

## Attempt/history dan pemilihan aset checkout — 17 Oktober 2026

- F2-01/F2-07 selesai: migration 005 menambahkan payment_attempts, backfill seluruh invoice/transfer lama, invoice_version dan constraint satu kredit payment per invoice. Reservasi unik historis sekarang mengacu pada seluruh attempt, lintas project; placeholder lama tidak diaktifkan.
- Merchant dapat mengirim payment_options dengan satu/dua quote harga eksplisit. Satu attempt per aset direservasi atomik saat invoice dibuat; kembali ke aset lama memakai reference/nominal lama. Ini memperjelas keputusan awal: bukan membuat attempt/reservasi baru pada setiap klik. Tanpa payment_options, kontrak invoice satu aset tetap berlaku.
- POST /v1/checkout/asset dan proxy web memilih quote yang disetujui merchant dengan expected_version dan lock invoice. Tidak menerima harga dari browser; pending/expiry/review diverifikasi server-side dan RPC/token config harus sehat. Token checkout kini merupakan capability baca dan pemilihan quote terbatas, bukan akses merchant atau mark paid.
- F5-02/F5-07c selesai pada localnet: checkout memiliki konfirmasi belum mengirim sebelum mengganti aset. QR lama disembunyikan selama perubahan dan baru muncul setelah status terbaru dimuat. Timeout/conflict memicu refresh, bukan retry perubahan secara buta.
- Pencocokan menggunakan seluruh attempt. Pembayaran tepat waktu pada pilihan lama tetap dikenali; invoice/event menampilkan aset yang benar-benar dibayar. Quote yang belum pernah diaktifkan masuk review. Dua pembayaran lintas aset menghasilkan satu ledger/event confirmed; pembayaran tambahan tetap review.
- Invoice version meningkat saat pemilihan aset, expiry dan paid; payment.confirmed memakai versi hasil commit serta attempt_id. F4-09 tetap parsial karena seluruh lifecycle/review event belum dipancarkan.
- Bukti: 85 test unit/integrasi PostgreSQL dan 39 test browser fixture lulus. Tiga test browser+chain pada Docker lulus: USDT reference, USDC manual, serta ganti aset → bayar pilihan lama → pembayaran kedua lintas aset → satu signed receipt/fulfillment. Typecheck/lint/build lulus.
- Rollout lokal terkoordinasi: API/worker lama dihentikan, migration memakai image baru, kemudian API/worker/web baru dijalankan bersama; validator, database, ledger dan volume tidak direset. Penulis invoice versi lama tidak boleh dijalankan kembali setelah migration tanpa rencana kompatibilitas.
- Fase 5 tetap Berjalan: wallet nyata, Safari/perangkat fisik serta redaksi ingress/APM masih terbuka. Gate lifecycle webhook sebelum produksi tetap berlaku.

Panduan dan contoh request: [PAYMENT-ATTEMPTS.md](PAYMENT-ATTEMPTS.md). Langkah berikutnya yang bisa dilakukan lokal: dokumentasi/playground Fase 6; kompatibilitas wallet dilanjutkan melalui Devnet, dengan tugas fondasi terbuka tetap dilacak.

## Fase 6 dimulai — dokumentasi dan playground localnet

- /docs memuat quickstart/auth/invoice, amount/reference/finality, webhook, error dan persiapan Devnet. Referensi OpenAPI dimuat dari gateway yang berjalan, disertai curl dan snippet signature receiver; kelengkapan schema mengikuti API sebenarnya.
- /docs/playground menyediakan generator invoice, project fixture tetap, quote dua aset, expiry, retry creation dengan key sama, panel request/response tanpa kredensial, checkout QR/copy dan timeline dari database/gateway. Reload memuat invoice lokal terakhir.
- F6-05 memakai service local-tools terpisah. Tombol tepat/manual/kurang/lebih mengirim mock token ke validator sebenarnya, bukan memaksa paid. API/worker tetap watch-only. Helper tidak tersedia pada staging/Devnet/Mainnet atau hostname publik.
- Migration 006/007 mencatat action dan menjamin satu perintah bayar per invoice; retry request ID membaca hasil yang sama. Satu pengiriman pending global dan singleton runner membatasi concurrency. Restart/timeout menjadi unknown, tidak mengulang broadcast secara otomatis.
- F6-06 parsial: inbox, inspect payload, signature verification dan delivery status tersedia. Tombol replay dan simulasi merchant gagal di UI masih terbuka; API/CLI fase webhook tetap tersedia.
- F6-08 tetap terbuka: playground hosted memerlukan session/project isolation dan kuota. Implementasi ini sengaja hanya sandbox loopback/localnet; bukan layanan publik.
- Kebutuhan Devnet dicatat di DEVNET.md: public receiving address, payer wallet, SOL/USDC test, mock USDT, RPC dengan histori memadai serta DB/key/secret terpisah. F8-01/02 belum selesai; tidak menjalankan signer fixture pada jaringan eksternal.

Panduan: [PLAYGROUND.md](PLAYGROUND.md) dan [DEVNET.md](DEVNET.md). Fase 6 tetap Berjalan sampai F6-06/08 serta kriteria penerimaan terkait terpenuhi; tidak menutup tugas fondasi atau gate produksi yang masih terbuka.

Bukti Fase 6: 90 test unit/integrasi PostgreSQL dan 45 test browser fixture lulus; enam pemeriksaan docs/playground pada Docker diulang setelah perbaikan label dropdown dan lulus. Lima skenario browser+chain terverifikasi, termasuk generate/bayar seluruhnya dari playground sampai signed webhook serta underpayment partial tanpa paid. Migration 006/007 dan service local-tools sudah berjalan tanpa reset volume. Screenshot serta batas pengujian: [PLAYGROUND-QA.md](PLAYGROUND-QA.md).

## Persiapan wallet Devnet — alat setup operator

- F8 mulai dipersiapkan: public receiver/payer operator sudah tersedia dan saldo payer USDC Circle/SOL diverifikasi melalui RPC Devnet. Snapshot serta alamat di DEVNET.md.
- `pnpm devnet:setup` menyediakan alat operator loopback port 4400 untuk membuat ATA USDC penerima melalui Wallet Standard/Phantom. Chain/genesis/issuer/owner/payer dipin; transaksi hanya membuat ATA dan server tidak memiliki private key. Ini terpisah dari playground localnet dan tidak mengaktifkan layanan Devnet.
- F8-01 tetap terbuka: menunggu tanda tangan operator/finality ATA, mock USDT serta database/project/API key terpisah. F8-02 tetap terbuka: connect/sign khusus alat setup tersedia, integrasi pembayaran playground Devnet dan verifikasi Phantom nyata belum selesai.
- Pengamanan diuji terhadap cluster salah, payer salah, issuer program salah, ATA owner salah, ATA yang sudah siap, perubahan message, unsigned request, expiry dan timeout broadcast tanpa resend. QA browser memeriksa tampilan mobile, fallback tanpa wallet dan penolakan Origin asing. Tidak ada transaksi Devnet yang ditandatangani atau dikirim oleh agent.

Koreksi setup Devnet setelah uji Phantom operator: wallet menambahkan priority fee pada message yang belum berisi Compute Budget, sehingga pemeriksaan message menolak sebelum broadcast. Setup kini menyertakan batas 50.000 CU dan harga 0 micro-lamports/CU secara eksplisit; strict message equality tetap aktif. Simulasi unsigned Devnet versi baru berhasil dengan 18.318 CU/fee 5.000 lamports. F8-01/02 tetap terbuka sampai penandatanganan dan finality wallet nyata terverifikasi.

Setup ATA USDC Devnet melalui Phantom operator berhasil: transaksi `5Ga7jvhMQnJJDuB9gicQ6MeSz7xGe6w6zrhn6ipS8oYDqyE7uuudNsUZ4HG4YhynEXYY1czvoeSSVUEPnavZkzBe` finalized slot 511933085 tanpa error. ATA `CVJN54FDYAVo6ZVipWDuqKCXjeaQhWerMQMhoxw71HPz` terverifikasi initialized dengan mint Circle/owner Zekivo yang sesuai. Fee 5.000 dan deposit ATA 1.488.440 lamports; belum ada USDC yang ditransfer. Connect/sign Phantom desktop untuk setup terbukti, tetapi F8-01/02 masih menunggu provision gateway dan pengujian pembayaran; tidak mencentang keseluruhan fase. Bukti lengkap di DEVNET.md.

## Milestone UI sebelum provision gateway Devnet

Prioritas sesuai arahan operator: rapikan seluruh permukaan UI sebelum melanjutkan layanan Devnet. Scope gateway, receiving wallet watch-only dan kebijakan matching tetap sama.

- [x] UI-01 Pasang Tailwind CSS v4, shadcn/ui New York/Radix dan Lucide. Token tema/komponen bersama; CSS Modules hanya untuk struktur khusus halaman.
- [x] UI-02 Refonte homepage, panduan/navigasi developer, form/timeline playground dan seluruh status checkout untuk desktop/mobile. Tidak membuat dashboard admin palsu; Fase 7 tetap terbuka.
- [x] UI-03 Pasang Scalar pada `/docs/api`, membaca OpenAPI aktual, browser-only/lazy loaded. Try it langsung ke API, tanpa proxy eksternal atau otomatis membocorkan key merchant. CORS terikat WEB_ORIGIN dan loopback localnet pada port yang dikonfigurasi.
- [x] UI-04 Selaraskan alat setup wallet mandiri dan jelaskan status siap, biaya pembuatan ATA, serta tidak adanya transfer USDC agar operator tidak mengulang setup.
- [x] UI-05 Verifikasi responsive/keyboard/kontras dan regresi localnet invoice → checkout → finalized → signed webhook; catat keterbatasan browser/wallet nyata.

100 test unit/integrasi, 48 test browser pada image Docker akhir dan lima skenario browser+chain localnet lulus. Scalar Test Request GET /health menerima HTTP 200 langsung dari API. Build/typecheck/lint/format lulus. QA UI, koreksi temuan, screenshot serta batas audit: [UI-QA.md](UI-QA.md). Keputusan stack dan aturan menambah komponen: [UI-DESIGN.md](UI-DESIGN.md). F8-01/02 masih terbuka pada provision gateway/pembayaran Devnet; refonte ini tidak mengaktifkan Devnet/Mainnet.

## Gateway Devnet USDC mulai berjalan

- Compose Devnet terpisah memakai web 13100, API 14100, PostgreSQL 55433 dan volume/jaringan sendiri. Localnet tetap berjalan. Kredensial baru dalam `.env.devnet` mode 0600, tanpa seed/private key wallet.
- Konfigurasi aset aktif kini eksplisit: default localnet dua token, staging awal USDC saja. Genesis dan issuer USDC Circle dipin; readiness memvalidasi konfigurasi, mint serta ATA.
- Scanner Devnet 10 detik, request HTTPS diantrikan/jeda 350 ms per klien, bounded read retries/backoff/Retry-After. Tidak melakukan retry broadcast. F3-07 tetap parsial: failover, rekonsiliasi dan alert belum selesai.
- Batas awal finalized 511942411 dicatat sebelum invoice pertama dengan saldo ATA nol dan lock alokasi. Rerun provision tidak mereset cursor; missing history setelah batas tersebut tetap fail-closed. Pengujian PostgreSQL membuktikan penolakan DB environment lain, konfigurasi wallet berbeda, initial saldo nonzero, serta checkpoint hilang setelah invoice ada.
- `devnet:invoice` membuat/membuka ulang invoice USDC dengan idempotency identity privat; `devnet:inspect` memeriksa transfer/event. Halaman `/docs/devnet` membedakan instance staging dan localnet, dengan readiness aktual. Pembayaran pertama masih memerlukan transfer dan tanda tangan Phantom operator.
- WEBHOOK_DELIVERY=false: event confirmed tersedia setelah transfer sah; delivery Devnet menunggu receiver HTTPS milik kita. Tidak menyatakan webhook Devnet selesai berdasarkan inbox localnet.

Bukti: 110 test unit/integrasi, tiga test browser readonly pada Devnet aktual untuk desktop/mobile/narrow, build/typecheck/lint/format lulus. API readiness HTTP 200 dan checkpoint worker bergerak. F8-01/02 tetap parsial; pembayaran USDC nyata dari wallet, mock USDT dan webhook HTTPS belum diverifikasi. Panduan: [DEVNET.md](DEVNET.md).

Invoice USDC Devnet pertama `e2725f58-8604-4ee6-9bc2-3a09cb1a54f9` sudah dibuat dengan payable 1.000001, status awal pending. Retry CLI terbukti tidak menggandakan invoice. Checkout aktual/URI mint-owner-amount diverifikasi browser mobile tanpa overflow; worker watermark bergerak sampai 511944025. Menunggu pembayaran operator melalui Phantom, sehingga F8-03 belum dicentang. Capability checkout disimpan privat; lihat `pnpm devnet:invoice`.

USDC Devnet manual berhasil: invoice `e2725f58-8604-4ee6-9bc2-3a09cb1a54f9` dibayar 1.000001 USDC, transaksi `44ho5TngE6FiUcX3qGXYbZbcmoVw36JLG1cjCEBJxsvowPD1DZ5Qk7jzh5uJbX63UNr2ZwScJBnWcmfqSVWn9Ghr` finalized slot 511947316 tanpa error. Database paid/version 2, satu payment credit dan event payment.confirmed. Delivery masih disabled. F8-03a selesai; tugas mint Mock USDT F8-01b menjadi langkah aset berikutnya, tanpa mengganti receiving owner atau mereset histori USDC. Bukti di DEVNET.md.

#### Pembaruan F8-01b — Mock USDT (17 Oktober 2026)

- [x] Tool operator `/mock-usdt`: mint acak persisten, 6 desimal, 100 token pembeli, dua ATA, partial signature mint + signature Phantom, simulasi sebelum approval, validasi pesan, journal sebelum broadcast.
- [x] Simulasi pada RPC Solana Devnet berhasil tanpa mengirim transaksi; pengujian guard cluster/payer dan transaksi parsial tersedia.
- [x] Pembeli menandatangani setup; verifikasi mint dan kedua ATA finalized.
- [x] Provision USDT dan checkpoint khusus token tanpa mereset USDC; aktifkan kedua aset dan buat invoice uji USDT.
- [x] Bayar invoice Mock USDT melalui Phantom; verifikasi finalized → paid, satu kredit ledger dan satu event confirmed.

F8-01b selesai: setup finalized dan konfigurasi gateway terverifikasi. Pembayaran manual juga selesai sebagai F8-03b; pengujian wallet URI/QR dan webhook HTTPS tetap terbuka.

Mock USDT aktif pada Devnet; checkpoint awal 511954736, invoice uji pertama pending. USDC paid tetap terverifikasi. Seluruh 112 tes pada 13 file lolos, termasuk bootstrap token kedua setelah invoice USDC dan penolakan boundary pengganti setelah invoice token terkait.

### Pembayaran Mock USDT Devnet terverifikasi

Invoice `82beb8c4-42e6-476c-a60e-a0aa3ad8d4a1` sudah paid/version 2 dengan
1.000001 Mock USDT. Transfer `4wE9esR5KEvS8RBUn1NWkeR3nNVs2VwhDfvZ2pzGs5Q7pn9q1EHLMFVQBM65Lbtj5noML1cBesNKnUbd7Ce1GUP4`
tercatat finalized slot 511955651, satu kredit ledger payment, dan event confirmed
`8b3d0bdc-c27c-4f73-824c-afbb3c205402`. Delivery webhook Devnet masih disabled.
Ini menutup F8-03b, bukan seluruh Fase 8.

### F2-04 selesai — daftar invoice untuk fondasi dashboard

`GET /v1/invoices` menyediakan filter status/aset/order_id dan pagination cursor
1–100 (default 25). Urutan created_at+id stabil, perbandingan
cursor mempertahankan mikrodetik PostgreSQL. Summary tidak mengembalikan URL/token
checkout. List dan detail dibatasi project/environment/cluster; detail kini juga
memiliki filter environment+cluster eksplisit. Kontrak query/response muncul di
OpenAPI/Scalar. Tidak ada migration atau reset ledger yang diperlukan.

Pengujian API/database meliputi scope, filter, timestamp sama, cursor asing,
validasi input dan OpenAPI. Panduan: [INVOICE-API.md](INVOICE-API.md).
Pekerjaan berikutnya F1-07c + F7-01/02: fondasi login/session dan role dashboard.
Pengujian manipulasi pembayaran F8-08–10 tetap ditunda sesuai prioritas operator.

Bukti F2-04: 117 tes pada 14 file lulus dengan PostgreSQL; typecheck, lint pada
file terkait, format dan build seluruh workspace lulus. API Docker localnet
4100 dan Devnet 14100 sudah diperbarui tanpa migration/reset volume. Smoke HTTP
kedua instance: daftar invoice paid 200, cursor halaman berikutnya berjalan,
OpenAPI memiliki GET list dan readiness 200. Hanya service API yang direstart;
scanner, database dan frontend tetap berjalan.

### F7 dimulai — fondasi login/session dan role

- [x] F7-01a Integrasi Entra single-tenant memakai openid-client, authorization code + PKCE/state/nonce; allowlist tenant dan immutable user object ID. Tidak ada bypass login staging.
- [x] F7-01b Session opaque/hash di PostgreSQL, expiry satu jam, cookie HttpOnly/SameSite/Secure staging, state sekali pakai, logout dengan Origin+CSRF dan audit login/logout.
- [x] F7-01c Halaman `/login`, proxy auth same-origin dan `/dashboard` yang memverifikasi session/permission pada server; tertutup ketika konfigurasi belum tersedia.
- [ ] F7-01d Konfigurasi App Registration Zekivo dan verifikasi login/logout Entra nyata + kebijakan MFA/Conditional Access. Memerlukan tenant/client/credential dan object ID operator; secret hanya melalui env privat.
- [x] F7-02a Definisi role admin/operator/read-only dan kontrak permission; role/allowlist diperiksa setiap pembacaan session.
- [ ] F7-02b Terapkan permission dan scope project pada seluruh endpoint manajemen berikutnya, audit perubahan sensitif, reauth dan pengelolaan/revokasi akses operator. Definisi role saja belum menyelesaikan RBAC operasional.

F1-07c/F7-01/F7-02 tetap parsial sampai verifikasi Entra dan tugas akses terkait
selesai. Migration 008 hanya menambah data autentikasi, tidak mengubah pembayaran.
Panduan konfigurasi dan batas verifikasi: [ADMIN-AUTH.md](ADMIN-AUTH.md).

Bukti fondasi F7: 126 tes pada 16 file lulus; typecheck/lint terkait/format/build
lulus. QA login mobile/desktop dan guard dashboard lolos, termasuk pemeriksaan
axe tanpa pelanggaran pada halaman login. Migration 008 diterapkan pada localnet
serta Devnet dan API/web diperbarui. Credential Entra belum dikonfigurasi; login
tertutup, verifikasi provider/MFA nyata tetap terbuka. Operator menyatakan belum
memiliki App Registration, sehingga langkah berikutnya adalah setup `Zekivo PG
Devnet` mengikuti ADMIN-AUTH.md, lalu uji login/logout sebelum dashboard data.

Aktivasi Entra Devnet: konfigurasi privat kini lolos validasi dengan satu grant
admin, discovery tenant berhasil, readiness 200 dan session anonim 401. Browser
nyata berhasil membuka form masuk Microsoft tanpa kode error AADSTS. Bug form
Origin null akibat Referrer-Policy diperbaiki dengan same-origin khusus halaman
login; pemeriksaan CSRF Origin tidak dilonggarkan. Tiga test browser regresi
(desktop/mobile/narrow) lulus. F7-01d masih menunggu operator login/MFA dan callback
berhasil; client secret/identitas belum dinyatakan terverifikasi lewat code exchange.

Operator melaporkan login Entra berhasil. Audit Devnet mengonfirmasi satu
session.created dan satu session aktif. Callback/code exchange serta pembentukan
session aplikasi kini terverifikasi, tanpa memeriksa atau menampilkan cookie/token.
F7-01d tetap parsial untuk logout/revocation nyata dan verifikasi kebijakan MFA
pada Entra; keberhasilan login tidak membuktikan kebijakan MFA sudah enforced.
Prioritas berikutnya: F7-03/04, overview serta daftar/detail invoice melalui API
admin yang memeriksa session/permission server-side, tanpa merchant key di browser.

### Dashboard baca tersedia — F7-03a / F7-04a–b

Dashboard menggantikan placeholder akses dengan overview, daftar berfilter,
pagination dan detail transaksi/event/delivery. API admin memverifikasi session,
allowlist dan dashboard:read setiap request. Scope environment+cluster wajib;
role internal saat ini membaca seluruh project dalam scope tersebut. Filter
project tidak dianggap grant. Merchant API key tidak dipakai browser.

131 tes pada 17 file serta enam browser fixture desktop/mobile/narrow lulus;
typecheck, lint terkait dan build lulus. Preview menggunakan fixture API terpisah,
bukan bypass Entra di aplikasi atau identitas palsu dalam database Devnet.
Panduan/batas implementasi: [DASHBOARD.md](DASHBOARD.md). F7-03/F7-04 parent tetap
parsial untuk saldo wallet serta transfer/history pagination, dan F7-02 masih
menunggu grant/endpoint manajemen. Lifecycle webhook, review queue dan F7-07
menjadi pekerjaan berikutnya; pengujian manipulasi F8-08–10 tetap backlog.

Rollout dashboard baca selesai pada Docker localnet dan Devnet: hanya API/web
diperbarui, tanpa migration/reset DB atau restart scanner. Smoke Devnet readiness
200, semua endpoint admin data menolak session anonim dengan 401/no-store, dan
halaman dashboard anonim redirect ke login. Dua invoice USDC/Mock USDT tetap
paid. Session operator yang sudah ada tidak dicabut; refresh dashboard memakai
cookie login yang sama. Fixture API/preview browser QA sudah dihentikan.

### UI admin profesional + saldo wallet/status scanner

Sesuai arahan operator, penataan visual sekaligus menambahkan kedua indikator
operasional. Sidebar/menu mobile, header workspace, metric cards, badge status,
filter/list/detail responsif dan refresh server tersedia. /admin/operations
menyediakan saldo finalized dan checkpoint terverifikasi dengan permission
backend; wallet bersama ditampilkan terpisah dari overview yang mengikuti project.

136 tes backend pada 18 file serta sembilan browser fixture lulus. Pembacaan
Devnet nyata berhasil untuk dua saldo 1.000001 dengan checkpoint current pada
snapshot pemeriksaan. F7-03 kini memiliki saldo sebagai metrik terpisah melalui
F7-07a; F7-07 parent masih terbuka untuk rekonsiliasi/job/alert. Tidak mengaktifkan
fitur tulis atau mengubah batas akses antar role/project. Rincian: DASHBOARD.md.

Catatan F7-03: overview global/per project, gross per token dan saldo wallet sudah
tersedia sebagai metrik berbeda. Parent tetap parsial untuk rincian counts
invoice per token; filter aset daftar tidak diam-diam mengubah arti overview.

Rollout UI+operasional selesai pada API/web Devnet dan localnet, tanpa migration
atau reset pembayaran. Smoke Devnet: readiness 200, operations anonim 401/no-store,
dashboard anonim menuju login. Pembacaan operasional dari container API selesai
2.517 ms: USDC/Mock USDT 1.000001, checkpoint current dan lag 68/62 slot pada
snapshot. Ini indikator baca, bukan bukti failover/rekonsiliasi/alert otomatis.
Session operator tidak diubah. Build/typecheck/lint/format dan sembilan browser
fixture lulus; screenshot akhir desktop/mobile tidak mencatat page error.

### Project management + API key — tahap pertama F7-06

Projects di sidebar kini menyediakan list/create/detail dan pengelolaan API key.
Tenant Entra tetap identitas perusahaan; project adalah integrasi website/app.
Session lama tetap membaca tetapi mutasi meminta autentikasi Microsoft baru
(auth_time <=10 menit), Origin/CSRF dan project:manage. Secret key hanya respons
penerbitan pertama; retry tidak membuat key tambahan atau mengembalikan secret.
Revoke idempotent dan audit actor/tenant/project ditulis atomik bersama perubahan.

Migration 009 additive mempertahankan key/pembayaran lama. Backend merchant key
langsung menolak credential yang dicabut. Testing memakai schema/fixture terpisah,
tidak membuat/mencabut key Devnet milik operator. Parent F7-06 masih terbuka untuk
webhook settings/delivery/replay, dan F7-02 masih terbuka untuk grant per project
serta audit operasi sensitif berikutnya. Lihat PROJECTS-API-KEYS.md.

Bukti F7-06a/b: 144 tes backend pada 19 file dan 21 browser dashboard/project
lulus; typecheck/lint/format/build berhasil. Migration 009 serta API/web terpasang
pada localnet/Devnet. Smoke Devnet readiness 200, mutasi anonim 401 dan key lama
tetap membaca USDC/Mock USDT paid. Tidak ada mutasi project/key Devnet nyata pada
pengujian. Flow reauth issuer meminta prompt login/max_age=0; operator perlu
menyelesaikan callback fresh-auth sebelum aksi tulis. Webhook settings/delivery
admin F7-06c menjadi langkah berikutnya.

### Dashboard webhook project — F7-06c

Endpoint HTTPS, rotasi signing secret satu kali, daftar delivery dengan cursor,
detail attempt dan replay tersedia dari tab Webhooks pada detail project.
Create/rotate memerlukan admin; replay juga tersedia untuk operator. Semua write
memerlukan CSRF, Origin, fresh auth dan request UUID. Retry UUID yang sama tidak
mengulangi rotasi/replay. Audit identitas admin dan audit merchant atomik dengan
mutasi. Endpoint memakai validator SSRF merchant yang sama; delivery dibatasi
invoice environment/cluster, tanpa mengubah status pembayaran.

Bukti: 148 tes backend pada 20 file serta 27 browser dashboard/project/webhook
pada desktop, mobile dan narrow lulus. Typecheck, lint dan build lulus. Screenshot
[desktop](qa/admin-webhooks-desktop-fixture.png) dan
[mobile](qa/admin-webhooks-mobile-fixture.png) memakai fixture terisolasi. API/web
localnet dan Devnet diperbarui tanpa reset database. Pengujian tidak mendaftarkan
endpoint eksternal nyata atau melakukan rotasi key milik operator.

Devnet tetap WEBHOOK_DELIVERY=false: pengiriman HTTPS nyata dan callback fresh
auth Microsoft oleh operator belum dinyatakan terverifikasi. F7-06 parent tetap
terbuka untuk workflow rotasi API key terkoordinasi; F7-02 grant per project,
review queue, rekonsiliasi/alert dan lifecycle webhook belum selesai. Langkah
berikutnya: review queue transaksi bermasalah, kemudian melanjutkan gate F7/F8.
Panduan dan batas operasional: [WEBHOOKS.md](WEBHOOKS.md).

### Navigasi API keys dan review queue — F7-05

Tab API keys dipisahkan menjadi halaman project `/api-keys` dengan active state
sesuai URL. Sebelumnya tab berupa anchor sehingga tampilan tetap menandai Overview.

Review queue mencakup seluruh transfer non-paid yang tercatat scanner pada scope
aktif, termasuk unmatched tanpa project. Filter status/masalah/project/aset,
cursor list dan catatan, bukti transfer/Explorer/invoice, catatan operator,
close/reopen dan audit tersedia. Write admin/operator memakai CSRF/fresh auth,
request idempotent, lock serta optimistic version untuk mencegah perubahan
operator tertimpa. Penutupan review hanya status pekerjaan; tidak mengubah
invoice, ledger, klasifikasi transfer atau webhook. Auto/manual settlement dan
refund tidak ditambahkan pada tahap ini. Panduan: [REVIEW-QUEUE.md](REVIEW-QUEUE.md).

Bukti tahap ini: 154 tes backend pada 21 file dan 39 tes browser admin pada
viewport desktop/mobile/narrow lulus; typecheck, lint, format dan build lulus.
Tes navigasi mengklik tab API keys dan memeriksa URL serta active state.
Migration 010 diterapkan pada localnet dan Devnet tanpa reset volume; API/web
sudah diperbarui. Dua invoice Devnet tetap paid; tidak ada review/catatan yang
ditulis pada Devnet selama pengujian. Screenshot fixture:
[desktop](qa/admin-reviews-desktop-fixture.png),
[mobile](qa/admin-reviews-mobile-fixture.png).
F7-04c daftar transfer global/pagination histori serta F7-07b rekonsiliasi/alert
masih terbuka; F7 belum dinyatakan selesai seluruhnya.

### Notifikasi SMTP / Telegram dan Mailpit

Prioritas notifikasi didahulukan sesuai arahan operator. Kanal internal per
environment/cluster dapat disimpan melalui dashboard dengan secret terenkripsi,
permission admin, fresh auth, CSRF, idempotency dan audit. Log memiliki status
waiting_configuration/pending/inflight/sent/dead/expired. Tidak ada kanal aktif
berarti antrean menunggu, maksimal usia 24 jam. Collector mendeteksi sumber baru
setelah cutoff persisten; tidak membanjiri operator dengan invoice historis.

Mailpit existing port 1025/8025 dipakai sebagai capture SMTP, tanpa mengubah
service atau menghapus inbox. Mode Mailpit lokal juga dapat dipilih pada gateway
Devnet lokal dengan opt-in eksplisit. Smoke terisolasi membuktikan antrean → SMTP
→ pencarian pesan dan verifikasi body di inbox. SMTP publik tetap TLS dan
Telegram nyata tetap menunggu credential operator. Panduan:
[NOTIFICATIONS.md](NOTIFICATIONS.md).

F7-07b induk tetap terbuka: rekonsiliasi/monitor eksternal belum dibuat, dan
F7-04c Transactions/pagination histori tetap menjadi tugas berikutnya.

Bukti notifikasi: 168 tes backend/23 file lulus; 48 kasus browser admin diperiksa,
dengan 24 kasus notifikasi/API keys diulang setelah perbaikan refresh form dan
lulus. Build/typecheck/lint/format lulus. Smoke Mailpit nyata dari host dan worker
Docker masing-masing sent pada attempt pertama, ditemukan melalui subject unik
dan body terverifikasi. Schema sementara dibersihkan, inbox tidak dihapus.
Migration 011 dan API/web/worker localnet/Devnet sudah diperbarui. Readiness 200;
scanner Devnet healthy, dua invoice tetap paid, konfigurasi kanal tetap kosong
dan nol alert pembayaran historis. Telegram eksternal/SMTP publik menunggu
konfigurasi dan uji operator. Screenshot fixture:
[desktop](qa/admin-notifications-desktop-fixture.png),
[mobile](qa/admin-notifications-mobile-fixture.png).

### Pemisahan halaman Overview dan Wallet & scanner

Panel receiving wallet, saldo finalized dan checkpoint scanner dipindahkan ke
`/dashboard/wallet`. Menu sidebar/mobile memakai URL halaman dan active state.
Overview tetap berisi ringkasan pembayaran, penerimaan bruto dan daftar invoice,
tanpa memuat data operasi RPC. Ini merapikan F7-07a, bukan menyelesaikan
rekonsiliasi F7-07b2. Berikutnya tetap F7-04c: Transactions global berfilter dan
pagination histori detail, kemudian rekonsiliasi/uptime monitor independen.

Verifikasi pemisahan: sembilan kasus browser dashboard pada desktop/mobile/narrow
lulus, mencakup tidak adanya panel wallet pada Overview, halaman wallet terpisah,
menu aktif, kembali ke invoice, aksesibilitas dan tidak ada overflow. Build web,
typecheck, lint serta format lulus. Web localnet/Devnet diperbarui tanpa perubahan
API, worker atau database. Screenshot fixture:
[desktop](qa/wallet-page-desktop-fixture.png),
[mobile](qa/wallet-page-mobile-fixture.png).

### Transactions dan histori invoice — F7-04c

Halaman Transactions menampilkan transfer finalized yang tersimpan, termasuk
paid dan tanpa invoice, filter project/aset/klasifikasi/signature lengkap serta
cursor 25 baris. Rincian mint/destination/slot/instruction, link Explorer sesuai
cluster, invoice dan review tersedia. Setiap instruction transfer tetap baris
tersendiri meskipun signature sama.

Riwayat transfer/event/delivery detail invoice kini memiliki cursor independen
100 item per bagian, validasi kepemilikan cursor dan tie-breaker ID pada timestamp
sama. Perpindahan satu bagian mempertahankan posisi bagian lain. API tetap
read-only, session/permission dan scope environment/cluster server. Migration 012
menambah index histori. Panduan: [TRANSACTIONS.md](TRANSACTIONS.md).

Bukti F7-04c: 172 tes backend/24 file dan 15 tes browser dashboard/Transactions
pada desktop/mobile/narrow lulus. Kasus 105 item per histori, timestamp sama,
foreign cursor, scope, signature multi-instruction serta filter/pagination
terverifikasi; typecheck/lint/format/build lulus. Migration 012 dan API/web
localnet/Devnet diperbarui tanpa reset data/restart worker. Readiness 200 dan
kedua invoice Devnet tetap paid. Screenshot fixture:
[desktop](qa/transactions-desktop-fixture.png),
[mobile](qa/transactions-mobile-fixture.png).
Langkah berikutnya F7-07b2: rekonsiliasi terjadwal dan uptime monitor independen,
menggunakan kanal notifikasi yang sudah tersedia untuk hasil pemeriksaan.

### Rekonsiliasi terjadwal dan monitor terpisah

Service monitor baru menjalankan pemeriksaan read-only snapshot seluruh invoice,
ledger/transfer/attempt dan event confirmed, serta batch 10 transfer paid ke RPC
finalized. Cursor, lease 10 menit, jadwal 15 menit setelah selesai, riwayat dan
contoh temuan persisten. RPC unavailable tidak menghasilkan clean atau menggeser
cursor. Tidak ada auto-repair/settlement/refund. Menu Monitoring menampilkan
cakupan snapshot/batch secara eksplisit.

Loop uptime dan dispatcher notifikasi berjalan pada service monitor terpisah
sehingga tidak bergantung proses worker utama. Tiga kegagalan berturut-turut,
cooldown satu jam dan recovery dicatat. Parent F7-07b2 tetap parsial: monitor
lokal berbagi host/DB; Azure uptime eksternal dan coverage penuh incoming/outgoing
wallet belum dipasang. Panduan: [MONITORING.md](MONITORING.md).

Bukti monitoring: 187 tes backend/26 file dan 18 tes browser dashboard/monitoring
lulus. Typecheck/lint/format, build web dan bundle monitor lulus. Migration 013 dan
API/web/monitor localnet/Devnet aktif tanpa reset DB atau restart worker utama.
Run pertama Devnet clean: 2 invoice, 2/2 transfer paid cocok dengan RPC finalized,
nol temuan dan akhir putaran tercapai. Semua komponen healthy dan kedua invoice
tetap paid; monitor tidak menerima secret Entra atau mengaktifkan webhook merchant.

Localnet mengungkap histori lama terpangkas: slot paid 282–23.719 di bawah
getFirstAvailableBlock 72.223. Run tetap unavailable (10 bukti batch tidak dapat
dibaca), tanpa mengubah status/data atau memaksa cursor maju. Sumber bukti archival
serta penanganan backlog unverifiable tetap gate keandalan/coverage sebelum
produksi. Monitor lokal bukan pengganti uptime dari luar host/DB di tahap Azure.
Screenshot fixture: [desktop](qa/monitoring-desktop-fixture.png),
[mobile](qa/monitoring-mobile-fixture.png).

### Overview, halaman invoice dan rotasi API key

Overview `/dashboard` sekarang khusus metrik invoice seluruh periode dan bruto
ledger per aset, dengan filter project serta tautan operasional. Daftar/filter/
pagination dipindah ke `/dashboard/invoices`, navigasi aktif untuk daftar/detail,
dan tautan kembali detail menuju daftar. Memilih project di Overview diteruskan
melalui Lihat invoice; pencarian invoice tidak mengubah scope metrik Overview.
Angka review dijelaskan sebagai jumlah invoice dengan transfer terbuka, bukan
seluruh transfer review yang termasuk unmatched.

F7-06 selesai untuk workflow rotasi API key: penerbitan pengganti sekali tampil,
masa transisi 1/24/72 jam, expiry diperiksa langsung di autentikasi merchant,
relasi key lama/pengganti, pencabutan dini serta audit+journal atomik. Migration
014 menambah metadata nullable sehingga key aktif lama tidak berubah. Tidak ada
rotasi credential asli operator atau penggantian secret website otomatis.
Grant lintas project F7-02 dan callback/MFA operator F7-01 tetap terpisah.

Verifikasi perubahan ini: 189 tes backend pada 26 file dan 27 tes browser fixture
pada desktop 1440, mobile 390 dan narrow 320 px lulus. Browser mencakup navigasi,
filter/pagination, empty state, akses read-only, key sekali tampil, transisi rotasi,
no horizontal overflow dan axe pada overview/detail/project. Typecheck, lint,
format dan build web lulus. Migration 014 diterapkan pada local dan Devnet tanpa
reset data atau perubahan key operator. Bukti visual memakai fixture:
[Overview desktop](qa/overview-separate-desktop-fixture.png),
[Overview mobile](qa/overview-separate-mobile-fixture.png),
[Invoice desktop](qa/invoices-separate-desktop-fixture.png),
[Invoice mobile](qa/invoices-separate-mobile-fixture.png).

### Register refund manual — F7-08

Detail invoice sekarang memiliki halaman Riwayat refund: admin mencatat refund
kredit invoice paid yang sudah dikirim sendiri dari canonical ATA treasury.
Aplikasi memverifikasi finalized signature+instruction, source/destination/mint/
amount dan cluster, lalu menyimpan receipt+audit atomik. Alamat tujuan wajib
mendapat konfirmasi admin melalui kanal pembeli; ini bukan bukti identitas wallet.
Refund parsial, cap kumulatif per aset terhadap ledger payment, lock invoice,
idempotency, bukti unik lintas invoice dan cursor history tersedia. Role operator/
read-only dapat membaca; write admin memakai fresh auth/CSRF/Origin.

Migration 015 bersifat tambahan. Tidak mengubah status paid, ledger payment,
confirmed webhook atau saldo; aplikasi tidak memegang signer/mengirim dana.
Refund tercatat terpisah dari bruto, belum debit/net revenue atau refund webhook.
Lihat [REFUNDS.md](REFUNDS.md). Workflow unmatched/partial/extra overpayment,
request/approval sebelum kirim dan treasury alternatif tetap tindak lanjut;
bukti refund Devnet nyata masih perlu dilakukan operator, tidak dipalsukan QA.

Verifikasi refund: suite penuh 209 tes backend pada 28 file lulus; tambahan
kasus konkurensi UUID lintas invoice juga lulus dalam 8 tes API refund terisolasi.
Sembilan tes browser refund lulus pada desktop/mobile/320 px; 27 tes dashboard/
project yang terdampak juga lulus. Typecheck/lint/format dan build web lulus.
Bukti screenshot adalah fixture, bukan refund Devnet nyata:
[desktop](qa/refund-desktop-fixture.png), [mobile](qa/refund-mobile-fixture.png).

Rollout local/Devnet: migration 015 diterapkan, API/web diperbarui. Readiness
keduanya 200; endpoint refund anonim 401 no-store dan halaman anonim redirect
login. Devnet tetap 2 invoice paid, 2 kredit payment, 0 refund: pengujian tidak
mengirim uang atau menyisipkan receipt pada database operator. Bukti refund
Devnet nyata tetap tindak lanjut F7-08a.

### Uji refund blockchain dan preflight Devnet

`pnpm local:refund-smoke [USDC|USDT]` memakai schema terisolasi, mint/treasury baru,
transaksi lokal finalized dan API/verifier asli. Smoke tidak menambah invoice
pada database operasional atau memakai signer Devnet. Uji mencakup nominal salah,
receipt, replay/duplikasi dan immutabilitas kredit/event pembayaran. Penantian
waktu validator menghindari race pembayaran otomatis tepat setelah invoice dibuat;
aturan matching tidak diubah. Output publik dan bukti hasil ada pada
`test-results/refund-chain-smoke.json` setelah schema dibersihkan.

`pnpm devnet:refund-inspect` menyediakan preflight dan pencarian instruction path
setelah signature tersedia, dengan koneksi database read-only. Pemeriksaan USDC
Devnet menunjukkan wallet treasury 0 SOL, 1.000001 USDC dan belum ada refund.
Operator perlu SOL Devnet pada wallet PG dan menandatangani transfer melalui
Phantom untuk menyelesaikan bukti refund Devnet F7-08a. Tidak ada transfer atau
pencatatan yang dilakukan alat inspeksi.

Bukti run gabungan lokal 2026-10-17T10:57:15.598Z: kedua aset lulus dengan
RPC/verifier/admin API asli, nominal salah 422 dan duplikasi 409. Setiap invoice
tetap paid, 1 kredit, 1 event, 1 receipt dan 1 audit refund. Schema fixture setelah
run diverifikasi 0 tersisa. Typecheck, lint/format dan guard salah scope lulus.
Percobaan awal USDT sempat berhenti karena payment belum settle; setelah
menambahkan penantian clock dan diagnosis sebelum refund, run gabungan lulus.

- USDC signature refund: `5e9Q4vgVJEsM5xW4XmaERKc9shDHTSkLnvCypEmVcAmoAvq9fM6235mSUMPiYdxZZGTkg3JKJAxpQJN6GRLH9ra5`.
- USDT signature refund: `5LjhhqytRLUNSxp435mfkaUT7FxGegYwefSjEGuvAs6UU1bNihnXirXLnT5nrUqKX6mLSbDcJwkqpEu3YY3VQaW2`.
  Bukti ini hanya localnet; refund Devnet operator tetap belum dilakukan.

### Arah deployment: staging Devnet dahulu

Sesuai arahan operator, pekerjaan kesiapan/deployment saat ini ditargetkan ke
staging Devnet, bukan live production/Mainnet. Akses repository GitHub dan CI
repository menunggu link yang akan diberikan operator; belum membuat repo,
remote, push atau deploy live. Fase 10–11 tetap rencana berikutnya dan memerlukan
arahan terpisah. Production/Mainnet tetap dinonaktifkan pada konfigurasi aplikasi.
Uji refund wallet Devnet manual dilewati atas permintaan operator: bukan bukti
lulus Devnet dan tidak menjadi penghambat pekerjaan webhook/staging. F7-08a
masih memuat pengembangan refund lanjutan, tanpa kewajiban uji wallet manual saat ini.

### Webhook lifecycle dan kesiapan staging

F4-08/F4-09: partial/overpaid/late/review_required untuk invoice teridentifikasi,
expiry pending scope instance, outbox atomik dan invoice_version monoton tersedia.
Event review memakai identitas transfer sehingga kejadian berbeda tidak tertimpa;
confirmed/expired tetap masing-masing satu per invoice. Unmatched/ambiguous tidak
menjadi event merchant. Receiver sandbox menangani review versi lebih baru yang
mendahului confirmed, mempertahankan paid dan satu fulfillment; verifikasi pesanan
backend sesungguhnya tetap gate integrasi staging.

Migration 016 wajib sebelum worker baru. Expiry 100 item per tick memakai row lock,
SKIP LOCKED dan commit expiry/version/outbox bersama. Tidak backfill expiry/review
historis. Event baru tidak mengubah aturan matching/finality atau menjadikan
partial/overpaid sebagai kredit. F4-10 payment.detected tetap menunggu observasi
pre-finality. [WEBHOOKS.md](WEBHOOKS.md) memuat kontrak dan urutan event.

[Kesiapan staging](STAGING-READINESS.md) mengurutkan Entra/MFA, akses project,
HTTPS receiver, resource terpisah, migration/backup, delivery nyata, gangguan,
security/load dan external uptime. Belum membuat GitHub repo/pipeline atau Azure
resource. WEBHOOK_DELIVERY Devnet tetap false hingga endpoint staging disiapkan.

Verifikasi lifecycle: 218 tes backend pada 29 file lulus, termasuk 7 skenario
lifecycle terisolasi dan receiver out-of-order. Build workspace, typecheck, lint
dan format lulus. Tidak menyatakan delivery HTTPS Devnet sudah diuji; tetap
menunggu endpoint staging. Uji refund wallet manual tidak dilanjutkan.

Rollout lifecycle: migration 016 diterapkan local/Devnet, API/web/worker diperbarui
dan receiver lokal memakai kontrak enam event. Ready local dan Devnet 200.
Smoke HTTP lokal setelah rollout lulus: USDT normal+replay 2 attempt, USDC
timeout setelah commit+retry+replay 3 attempt, masing-masing fulfillment 1.
Bukti invoice lokal: `cab60357-2f2b-45ff-828f-0788957377dc` dan
`24932a67-be3f-4f84-8f81-f097f70d1992`. Tes lifecycle tambahan memakai schema
terisolasi; smoke HTTP ini menguji jalur confirmed nyata. Devnet tetap 2 paid,
0 refund, WEBHOOK_DELIVERY=false; endpoint HTTPS staging belum disiapkan.

### Inventory akses staging Azure

Azure CLI sudah login; subscription Enabled dan Owner user terverifikasi.
Southeast Asia tersedia pada katalog Container Apps/PostgreSQL. Provider App
Registered; PostgreSQL/Container Registry perlu registrasi. Repo SSH telah
diberikan; belum init/push/deploy. Inventory budget/expiry dan validasi quota/SKU
masih terbuka F9-01/F9-11. Contoh config scope staging tersedia di infra/azure,
bukan Bicep deployment. Detail: STAGING-READINESS.md.

Keputusan operator staging: batas US$200/bulan, kredit berakhir Juli 2027 (tanggal persis belum diketahui), URL HTTPS bawaan Azure. Bicep CLI tersedia; registrasi provider yang diperlukan dimulai. Resource berbayar belum dibuat.

### Integrasi GitHub dan rancangan staging

Workspace diinisialisasi Git dengan origin SSH repo afuzapratama/zekivo-pg-crypto.
Repo public; secret scanning/push protection GitHub terkonfirmasi aktif. Initial
import mengecualikan .env.devnet, .devnet, private key, output build dan artefak
tes. Workflow aplikasi memeriksa migration/lint/typegen/typecheck/test/build/browser;
workflow infrastruktur compile Bicep tanpa login/deploy. Actions dipin SHA dan
Dependabot disiapkan. Hasil push/CI dicatat setelah verifikasi, bukan diasumsikan.

Bicep foundation/workloads/manual bootstrap+migration jobs/budget selesai disusun,
compile lulus dan foundation subscription What-If Succeeded (1 RG+9 resource baru,
tanpa apply). Postgres privat, 4 app Consumption satu replica masing-masing,
identity+secret-scope RBAC, runtime DB role terpisah dari migrator. Estimasi Retail
Prices API Southeast Asia 31 hari all-active tanpa free grants: US$197.44 termasuk
allowance+contingency. Margin budget sempit; bukan jaminan tagihan. Budget scope
mencakup RG staging dan RG managed environment. Detail infra/azure/README.md.

F9-02 rancangan tersedia, belum cloud workload deploy/secret/provision/image push.
F9-11 estimasi tersedia, billing currency+email budget dan harga/pemakaian aktual
masih perlu verifikasi sebelum apply. Staging Azure belum dibuat; Mainnet tetap off.

### Azure staging mulai diterapkan — 17 Oktober 2026

Catatan ini memperbarui inventory/rancangan sebelumnya. Deployment subscription
`zekivo-pg-staging-foundation-v1` dan `zekivo-pg-staging-budget-v1` Succeeded.
Resource staging berada di `rg-zekivo-pg-staging`, Southeast Asia; PostgreSQL 17
privat dan database `gateway_staging` sudah tersedia. Container Apps environment,
ACR, Key Vault, VNet/private DNS dan Log Analytics telah dibuat. Budget US$200/bulan
memantau RG aplikasi dan RG managed, dengan alert actual 50/80/100% dan forecast
100%; budget bukan pembatas otomatis biaya. Kredensial staging terpisah disimpan
di Key Vault dan file lokal ignored, tidak dalam Git/image.

PR #7 merged melalui required CI: 218 tes backend dan 48 tes browser lulus,
81 browser case khusus lingkungan lain skipped. Image dari tree yang sama dengan
commit `c61b6ec` tersedia di ACR dengan digest
`sha256:8a2e8fb7ca46564d47bcc4801f94d55f49a4b171d6bfa39a6c2d35319e7f39b5`.
Callback Microsoft untuk hostname Azure sudah ditambahkan tanpa menghapus localhost.
Provision Devnet memakai kebijakan saldo awal tercatat, future invoices only;
checkpoint lama tidak digeser dan saldo awal tidak dikreditkan sebagai pembayaran.

Mainnet dan webhook delivery tetap off. GitHub CI/branch protection aktif;
continuous deployment Azure/OIDC belum dikonfigurasi. Login operator dan pembayaran
Devnet di staging tetap perlu diverifikasi sebelum menyatakan integrasi lulus.

Bootstrap role dan migrasi cloud Succeeded; job bootstrap beserta identity/akses
sementara telah dihapus. Provision kedua token Succeeded. Workloads deployed dengan
image digest di atas. API `/ready` HTTP 200; API merchant berhasil membuat invoice
USDC `fb674a66-d822-4c26-9d3e-7a56f043707a` dan Mock USDT
`d1a1c47a-52fa-4fa6-908b-9b87c258b6a6`, keduanya awalnya pending meski wallet
mempunyai saldo dari tes lama. Tidak mengirim transaksi wallet otomatis.

Startup web pertama menemukan masalah direktori kerja Next.js pada monorepo.
Perintah deployment kini menyebut `apps/web` secara eksplisit; uji image runtime
0.25 CPU/512 MiB menghasilkan login HTTP 200. Revision Azure diperbarui memakai
image yang sama; pemeriksaan HTTPS dan login operator tetap gate terpisah.
