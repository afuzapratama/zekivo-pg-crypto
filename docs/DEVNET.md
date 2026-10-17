# Devnet Zekivo — setup dan pengujian USDC

**Status terbaru:** gateway USDC Devnet sudah diprovision terpisah di Docker lokal. API port 14100, web 13100, PostgreSQL 55433. Pembayaran manual USDC dari Phantom sudah terverifikasi; delivery webhook Devnet belum diaktifkan. Bagian setup wallet di bawah menyimpan kronologi pengujian sebelumnya.

Diperiksa dari dokumentasi issuer/Solana pada 17 Oktober 2026. Devnet adalah jaringan pengujian aplikasi dengan token tanpa nilai finansial; berbeda dari Solana Testnet untuk pengujian validator. Tidak membutuhkan pembelian crypto asli. Jaringan Devnet tetap eksternal, dapat mengalami reset dan pembatasan layanan. Sumber: [cluster Solana](https://solana.com/docs/references/clusters).

## Yang perlu tersedia

| Kebutuhan                      | Penggunaan                                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Receiving wallet khusus Devnet | Satu owner address dan dua ATA penerima. Gateway hanya menyimpan public address.                                                                                                     |
| Wallet pembayar khusus Devnet  | Menandatangani transaksi melalui wallet pengguna, dengan jaringan Devnet dipilih. Jangan memakai signer fixture localnet.                                                            |
| SOL Devnet                     | Membayar fee jaringan serta pembuatan mint/ATA oleh payer. [Faucet Solana](https://faucet.solana.com/); penerima tidak perlu membayar fee untuk menerima ke ATA yang sudah tersedia. |
| USDC test issuer               | Ambil dari [faucet Circle](https://faucet.circle.com/), pilih Solana Devnet. Bukan USDC mainnet.                                                                                     |
| Mock USDT milik kita           | Mint SPL 6 decimals dengan nama/label jelas Mock USDT Devnet. Tidak dianggap USDT resmi Tether dan tidak dijanjikan mempunyai perilaku issuer yang identik.                          |
| RPC Devnet                     | Awal bisa memakai endpoint publik; untuk scanner berulang perlu kuota dan histori transaksi yang memadai. Jangan fallback diam-diam ke Mainnet.                                      |
| Database dan secret terpisah   | Database, project, merchant key, secret webhook/encryption dan checkpoint sendiri; tidak menyalin database/reservasi/token config localnet.                                          |
| Wallet/browser sasaran         | Verifikasi dukungan Devnet, SPL token, Solana Pay reference dan nominal enam digit pada perangkat nyata.                                                                             |

Mint USDC Solana Devnet yang tercantum di [daftar Circle](https://developers.circle.com/stablecoins/usdc-contract-addresses):

```text
4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
```

Verifikasi lagi alamat, token program dan decimals sebelum provision. Jangan mengambil alamat Mainnet dari baris yang berbeda pada daftar issuer. Token USDC test tidak bernilai USD dan tidak dapat dipakai sebagai dana nyata.

Endpoint publik: `https://api.devnet.solana.com`. [Solana menjelaskan RPC publik dibatasi kuota](https://solana.com/docs/rpc); scanner Devnet sekarang memakai interval 10 detik dengan antrean request per klien, jeda minimum HTTPS 350 ms dan retry terbatas untuk read. Failover/reconciliation penuh masih terbuka; mengganti URL saja bukan bukti kesiapan Devnet. Saat memilih RPC, verifikasi getGenesisHash, getSignaturesForAddress pagination, getTransaction dan histori yang cukup untuk backfill. Kredit Azure bukan kredit RPC provider secara otomatis.

## Yang perlu kita kerjakan di kode

1. Provision staging Devnet secara terpisah: project/API key baru, receiving owner public, mock USDT mint, dua canonical ATA dan token_configs dengan genesis yang diverifikasi. Seed lokal dan private fixture deterministik harus tetap menolak Devnet.
2. Tambahkan pemeriksaan issuer mint, token program/decimals, owner ATA serta assertion genesis/cluster. Simpan bukti konfigurasi; jangan menebak cluster dari nama URL saja.
3. Siapkan wallet test dengan SOL/USDC test dan mock USDT. Private key mint/payer hanya pada alat setup/operator terpisah; API/worker tetap watch-only.
4. Tambahkan connect/sign Devnet pada playground terautentikasi atau pengujian wallet langsung. URI Solana Pay tidak memindahkan cluster wallet otomatis.
5. Lengkapi retry/backoff/rate-limit RPC, failover dan audit rentang histori. Gap pada non-local saat ini fail-closed; membutuhkan sumber histori yang utuh, bukan menghapus checkpoint.
6. Uji reference/manual, partial/overpaid/late, perubahan aset, crash/restart, RPC outage, webhook retry serta dedup fulfillment.

Konfigurasi inti yang sudah dikenali aplikasi:

```dotenv
APP_ENV=staging
SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
ENABLED_ASSETS=USDC
SCAN_INTERVAL_MS=10000
DATABASE_URL=postgres://DEVNET_USER:DEVNET_PASSWORD@DEVNET_DB:5432/gateway_devnet
CHAIN_MONITORING=false
WEBHOOK_DELIVERY=false
WEB_ORIGIN=http://localhost:3100
```

Contoh ini bukan perintah aktivasi siap pakai: database/identitas/provision token harus dibuat terlebih dahulu. Aktifkan CHAIN_MONITORING hanya setelah token_configs dan pemeriksaan cluster valid. Key enkripsi baru diperlukan sebelum mengaktifkan webhook; jangan gunakan fixture secret lokal. Mainnet/production masih ditolak oleh aplikasi.

## Apakah perlu Azure/domain sekarang?

Aplikasi dapat tetap berjalan di komputer lokal dan membaca Devnet melalui RPC eksternal. Untuk pengujian awal wallet browser/scan QR transfer request, Azure atau domain publik belum wajib. Untuk staging bersama tim, callback merchant HTTPS, session sandbox terisolasi dan pengujian lintas perangkat penuh, siapkan hosting/domain/TLS serta receiver merchant yang kita kendalikan. Endpoint webhook eksternal kita mewajibkan HTTPS publik dan tidak menerima endpoint HTTP local inbox pada staging.

Playground saat ini **khusus localnet**. Helper pengiriman mock bukan faucet Devnet, tidak menandatangani transaksi Devnet dan tidak boleh diekspos melalui tunnel publik. Hosted playground membutuhkan session/project sandbox terisolasi dan kuota (F6-08). F8-01/02 tetap terbuka sampai provision dan pengujian jaringan nyata selesai; menulis checklist bukan bukti Devnet sudah berjalan.

## Informasi yang nanti dibutuhkan dari operator

Alamat publik receiving wallet Devnet, wallet/browser sasaran, dan URL RPC Devnet jika memakai provider. Tidak perlu mengirim seed phrase atau private key ke chat atau memasukkannya ke API/worker. Mock USDT issuer/payer setup dapat dibuat pada alat operator terpisah saat tahap provision.

## Setup wallet operator yang tersedia

Alamat khusus pengujian yang diberikan operator:

| Peran               | Alamat publik                                  |
| ------------------- | ---------------------------------------------- |
| Penerima Zekivo PG  | `GGQtua3Q7Sdr4K3eCvJA7kiHXCsTCgGBrm7FqoJsPEkk` |
| Pembeli/payer setup | `3toF4H23Winv3CehGrxW7CaqMuFcbQVRfaDoa8upVLkt` |

Pemeriksaan RPC Devnet pada 17 Oktober 2026, slot finalized 511928781: payer memiliki 5 SOL dan 20 USDC dengan mint Circle di atas; penerima belum memiliki akun token. Ini snapshot, bukan saldo real-time.

Jalankan alat operator dari **terminal host**, bukan container API:

```sh
pnpm devnet:setup
```

Buka **http://localhost:4400** di browser desktop dengan ekstensi Phantom. Pilih akun pembeli dan jaringan Devnet, lalu tekan **Connect Phantom & buat akun USDC**. Tinjau transaksi di Phantom: hanya instruksi idempotent pembuatan ATA USDC untuk owner penerima, tanpa transfer USDC. Payer membayar fee dan deposit akun SOL Devnet. Angka fee/rent diambil dari RPC saat prepare, bukan konstanta biaya mainnet. Alat memakai Wallet Standard `solana:signTransaction`, chain `solana:devnet`, transaksi v0. Tanda tangan asli Phantom/perangkat pengguna belum diverifikasi dalam QA otomatis.

Setelah broadcast, simpan signature dan periksa melalui Explorer Devnet. Tunggu finalized, lalu tekan **Cek akun penerima** sampai `ready: true`. Gateway belum diaktifkan hanya karena broadcast berhasil. Jika wallet menolak, request kedaluwarsa, atau RPC timeout, periksa akun/transaksi terlebih dahulu; alat tidak otomatis mengulang pengiriman. Server restart menghapus request signing sementara, bukan akun blockchain.

Server bind hanya `127.0.0.1:4400`, mengharuskan Host `localhost:4400` dan Origin sama pada POST. Jangan mengekspos alat melalui tunnel/domain publik. Endpoint RPC, genesis, issuer mint, payer dan penerima dipin di `packages/devnet/src/setup.ts`; alat tidak membaca `.env` localnet, tidak memakai fixture signer, tidak menyimpan key, tidak mengubah database atau menyalakan watcher. Server membandingkan seluruh message transaksi yang ditandatangani dengan message yang disiapkan, kemudian broadcast hanya ke RPC Devnet dengan signature preflight aktif. Request hanya boleh dibroadcast sekali, termasuk bila hasil RPC ambigu. Tutup server dengan Ctrl+C setelah setup selesai.

**Sesudah ATA terverifikasi:** provision DB/project/API key terpisah, tambah mock USDT dan runtime scanner/backoff, kemudian invoice USDC pertama. Jangan membayar invoice localnet dengan token Devnet; playground pembayaran otomatis tetap localnet. USDC ATA saja belum menyelesaikan F8-01/02.

Referensi integrasi: [Phantom](https://docs.phantom.com/solana/integrating-phantom), [Wallet Standard Solana](https://github.com/wallet-standard/wallet-standard/blob/master/extensions/solana.md), [pembuatan akun token Solana](https://solana.com/docs/tokens/basics/create-token-account).

Bukti setup: 97 test unit/integrasi PostgreSQL, typecheck, lint dan format lulus. QA Chromium 390 px tidak menemukan overflow/error JavaScript; tanpa ekstensi menampilkan instruksi Phantom, POST Origin asing ditolak 403 dan payer salah 400. Simulasi unsigned pada RPC Devnet berhasil (`err: null`, tanpa broadcast), menghasilkan ATA `CVJN54FDYAVo6ZVipWDuqKCXjeaQhWerMQMhoxw71HPz` dengan mint/owner yang benar. Snapshot simulasi: rent 1.488.440 lamports, fee 5.000 lamports; alat mengambil ulang biaya saat prepare. Ini belum membuktikan persetujuan Phantom, finality akun atau pembayaran invoice.

### Koreksi kompatibilitas priority fee Phantom

Pengujian operator menemukan `Wallet returned a different transaction; rejected` setelah tanda tangan. Transaksi awal belum menyertakan Compute Budget, sementara Phantom menerapkan priority fee otomatis pada unsigned dapp transaction yang tidak mempunyai pengaturan tersebut; perilaku ini dijelaskan pada [dokumentasi priority fee Phantom](https://docs.phantom.com/developer-powertools/solana-priority-fees). Perbedaan fee pada layar operator konsisten dengan penambahan tersebut; byte transaksi lama tidak disimpan untuk perbandingan forensik.

Setup sekarang menyertakan `SetComputeUnitLimit(50000)` dan `SetComputeUnitPrice(0)` sebelum instruksi ATA, sehingga pengaturan priority fee sudah eksplisit. Ini kebijakan untuk setup Devnet, bukan rekomendasi biaya transaksi produksi. Pemeriksaan message byte-for-byte tetap aktif, termasuk menolak perubahan pengaturan fee oleh pengguna. Setelah update server, refresh halaman dan buat request baru; jangan gunakan transaksi yang disiapkan versi lama. Jangan ubah fee secara manual di Phantom.

Simulasi unsigned versi baru di Devnet berhasil: `err: null`, 18.318 CU dari limit 50.000, fee 5.000 lamports. Tidak dibroadcast oleh agent. Regression test memverifikasi pengaturan fee eksplisit, ATA tetap satu-satunya instruksi bisnis, dan transaksi yang berubah masih ditolak. Persetujuan Phantom nyata tetap menunggu operator.

### Setup ATA berhasil melalui Phantom operator

Transaksi [`5Ga7j…ZkzBe`](https://explorer.solana.com/tx/5Ga7jvhMQnJJDuB9gicQ6MeSz7xGe6w6zrhn6ipS8oYDqyE7uuudNsUZ4HG4YhynEXYY1czvoeSSVUEPnavZkzBe?cluster=devnet) diverifikasi langsung lewat RPC Devnet: finalized pada slot 511933085, `meta.err: null`. Owner, mint Circle dan ATA sesuai konfigurasi. Tanda tangan dilakukan operator melalui Phantom; agent hanya membaca hasil chain.

Debit payer 1.493.440 lamports terdiri dari fee jaringan 5.000 lamports dan deposit akun token 1.488.440 lamports. Saldo payer menjadi 4,99850656 SOL dan tetap 20 USDC; penerima memiliki ATA initialized dengan 0 USDC. Ini pembuatan akun, bukan pembayaran invoice. Saldo SOL owner penerima tetap nol; deposit tersimpan di alamat ATA, sehingga Explorer owner dapat menampilkan account does not exist sementara akun tokennya valid. Snapshot pengecekan saldo pada slot 511933919.

Kompatibilitas connect/sign Phantom desktop untuk transaksi setup ini telah terbukti. Provision gateway Devnet, pembayaran USDC, payment link/QR dan webhook Devnet belum diverifikasi; F8-01/02 tetap terbuka pada bagian tersebut.

## Menjalankan gateway Devnet terpisah

Instance ini menerima **USDC Circle Devnet saja** untuk pengujian pertama. Localnet tetap memakai kedua mock token. Mock USDT Devnet belum diprovision; jangan menggunakan mint localnet atau menganggap ada USDT Tether resmi dari alat ini.

```sh
pnpm devnet:init
pnpm devnet:up
pnpm devnet:invoice
pnpm devnet:inspect
```

`devnet:init` membuat `.env.devnet` mode 0600 dengan password database, project ID, API key dan encryption key baru. Tidak mencetak secret dan tidak mengganti file yang sudah ada. Jangan menghapus file itu setelah database berisi data. File `.env` localnet tetap terpisah. Aplikasi API/worker tidak menerima plaintext merchant key dari env-file provision; frontend tidak menerima kredensial database maupun API key.

`devnet:up` memakai `compose.devnet.yaml`, project Docker **zekivo-gateway-devnet**, volume PostgreSQL dan jaringan sendiri. Tidak menjalankan validator atau seed fixture lokal. API, worker dan web memerlukan provision selesai. Semua port hanya bind loopback:

| Layanan            | URL/port                                     |
| ------------------ | -------------------------------------------- |
| Web / panduan test | http://localhost:13100/docs/devnet           |
| API readiness      | http://127.0.0.1:14100/ready                 |
| Scalar             | http://localhost:13100/docs/api              |
| PostgreSQL         | 127.0.0.1:55433 / gateway_devnet             |
| Localnet lama      | Web 3100, API 4100, DB 55432; tetap terpisah |

Gunakan localhost untuk frontend Devnet, sesuai WEB_ORIGIN yang diizinkan CORS. Halaman root Devnet mengarah ke panduan pengujian, bukan menampilkan klaim localnet. Badge dan navigasi memakai environment runtime, termasuk pada build production. API `/api/devnet/status` hanya tersedia untuk staging/devnet dengan Host loopback; helper `/api/playground/*` tetap ditolak.

## Batas awal scanner dan pemulihan

Provision memverifikasi genesis Devnet, mint Circle, program SPL asli, decimals 6, receiving owner dan canonical ATA. `ENABLED_ASSETS=USDC` mengharuskan tepat satu konfigurasi USDC; default localnet tetap USDT,USDC. Ketidakcocokan konfigurasi membuat readiness gagal.

Provision awal memegang lock alokasi invoice dan hanya boleh menetapkan batas scan jika belum ada invoice dan saldo ATA masih nol. Audit `devnet.initial_scan_boundary` menyimpan genesis, ATA, finalized slot **511942411**, first-available slot **116113408**, serta kebijakan _future invoices only_. Batas ini bukan pemulihan histori sejak genesis. Sesudahnya scanner berjalan dengan watermark/overlap durable yang sama; gap pada non-local tetap fail-closed. Rerun provision tidak mengganti watermark, sekalipun sudah ada invoice atau saldo. Checkpoint hilang setelah invoice ada harus diperiksa; tidak diinisialisasi ulang otomatis.

Read RPC yang kena HTTP 429/502/503/504, kegagalan transport atau error sementara node tertentu dapat dicoba maksimal tiga kali lagi. Retry-After dihormati; cooldown lebih dari 30 detik menghentikan request agar dapat dicoba iterasi berikutnya. Broadcast/sendTransaction/requestAirdrop **tidak pernah di-retry otomatis**. Tidak ada failover endpoint otomatis atau jaminan histori arsip dalam milestone ini.

## Membayar invoice pertama

`pnpm devnet:invoice` memeriksa health staging/devnet dan readiness, lalu membuat invoice dasar **1 USDC**, expiry 3600 detik, dengan idempotency key yang disimpan sebelum request. Invoice/capability disimpan privat di `.devnet/invoice.json`, bukan pada dokumentasi publik. Mengulang perintah memakai order/request yang sama atau membuka kembali invoice terakhir. Untuk invoice baru gunakan `pnpm devnet:invoice --new` setelah memastikan tidak ada pembayaran yang sedang diproses.

Buka checkout_url yang dicetak. Untuk uji pertama gunakan **transfer manual Phantom di Devnet**: akun pembeli `3toF…pVLkt`, alamat penerima dari checkout, dan seluruh digit payable_amount. Jangan membulatkan ke nominal dasar 1. Checkout menunggu hasil finalized yang diverifikasi worker; tidak ada tombol mark paid. QR/Solana Pay tersedia, tetapi kompatibilitas link wallet Devnet belum dianggap terbukti hanya karena QR terbentuk.

Setelah bayar, `pnpm devnet:inspect` membaca invoice proyek Devnet, transfer, signature dan event. Status paid dan event payment.confirmed harus dibuktikan dengan transfer operator. Tidak ada transaksi pembayaran Devnet yang dikirim otomatis oleh perintah invoice/inspect atau QA browser.

## Webhook dan pekerjaan berikutnya

`WEBHOOK_DELIVERY=false` pada instance Devnet awal. Event pembayaran tetap dapat dibuat secara atomik di database setelah transfer valid; HTTP delivery membutuhkan endpoint merchant HTTPS publik yang kita kendalikan, registrasi endpoint dan pengaktifan delivery dengan secret baru. Tidak membuka pengecualian HTTP local-inbox pada staging. Azure belum digunakan pada milestone ini.

Sisa gate: pembayaran manual/reference USDC nyata melalui Phantom, webhook HTTPS, mock USDT, UI connect/sign sandbox Devnet yang terisolasi, failover/reconciliation/alerts dan skenario gangguan F8. Setup sebagian ini tidak menutup keseluruhan F8-01/02.

Verifikasi kode/runtime: 110 test unit/integrasi PostgreSQL lulus; tiga test browser pada instance Devnet aktual lulus (desktop/mobile/narrow), meliputi readiness, penandaan jaringan, axe/overflow dan penolakan helper localnet/Host asing. Typecheck/lint/format/build lulus. Watermark Devnet bergerak setelah worker aktif; localnet tetap hidup. Tidak menganggap pengujian readonly ini sebagai keberhasilan pembayaran atau delivery webhook Devnet.

### Invoice pertama siap dibayar operator

Invoice `e2725f58-8604-4ee6-9bc2-3a09cb1a54f9` dibuat pada 17 Oktober 2026, sekitar 10:53 WIB: USDC, payable_amount **1.000001**, status awal pending, expiry 11:53 WIB. Capability URL tidak disalin ke dokumentasi; tersimpan privat pada `.devnet/invoice.json` dan dapat dibuka kembali dengan `pnpm devnet:invoice`. Pengulangan perintah terbukti memakai invoice yang sama; database Devnet berisi satu invoice, nol transfer/event pada pemeriksaan awal.

Checkout aktual diuji pada Chromium mobile: URI memuat nominal 1.000001, mint Circle dan receiving owner yang sesuai; tidak overflow. Screenshot [checkout Devnet](qa/devnet-invoice-mobile.png) dan [readiness Devnet](qa/devnet-status-mobile.png) adalah data aktual sebelum pembayaran, bukan fixture. Checkpoint telah bergerak dari batas awal hingga slot 511944025 pada 10:54 WIB. Menunggu transfer bertanda tangan Phantom untuk memverifikasi paid/event confirmed.

### Pembayaran manual USDC berhasil

Operator membayar invoice `e2725f58-8604-4ee6-9bc2-3a09cb1a54f9` sebesar **1.000001 USDC Devnet**. Transaksi [`44ho5T…n9Ghr`](https://explorer.solana.com/tx/44ho5TngE6FiUcX3qGXYbZbcmoVw36JLG1cjCEBJxsvowPD1DZ5Qk7jzh5uJbX63UNr2ZwScJBnWcmfqSVWn9Ghr?cluster=devnet) diverifikasi lewat RPC: finalized, err null, slot 511947316. Saldo pascatransaksi pada ATA penerima 1.000001 USDC dan pembeli 18.999999 USDC.

Database: invoice paid, version 2, satu transfer disposition paid, tepat satu kredit payment ledger, dan event `payment.confirmed` `625a4e8e-2889-4d3b-b866-c50074bdb9e0`. Ini membuktikan jalur manual Devnet, bukan hanya simulasi/fixture. Delivery webhook masih disabled; event tersimpan belum berarti sudah dikirim ke merchant. Signature dibuat operator di Phantom, bukan agent.

Berikutnya USDT Devnet memakai mint **Mock USDT Zekivo** milik kita, 6 decimals, allowlist khusus Devnet dan ATA kedua di bawah receiving owner yang sama. Belum diprovision/diaktifkan. Mint uji ini tidak dianggap USDT resmi Tether. Integrasi Mainnet nantinya wajib memakai mint issuer resmi sesuai [panduan Tether](https://tether.to/en/supported-protocols/), bukan mint mock. Menambah USDT harus menjaga konfigurasi/cursor/ledger USDC dan menetapkan batas scan token baru sebelum invoice USDT pertama.

### Mock USDT Devnet: operator setup (17 Oktober 2026)

Tool tersedia melalui `pnpm devnet:setup`, lalu buka
<http://localhost:4400/mock-usdt> menggunakan Phantom desktop dengan akun pembeli
`3toF4H23Winv3CehGrxW7CaqMuFcbQVRfaDoa8upVLkt` pada jaringan Devnet.
Klik **Connect Phantom & buat 100 Mock USDT**, tinjau transaksi, lalu setujui.
Setelah finalized, klik **Cek akun penerima**. Ini setup token, belum pembayaran invoice.

Transaksi membuat mint SPL dengan 6 desimal, ATA pembeli dan ATA penerima PG,
lalu mencetak 100 token ke pembeli. Buyer menjadi mint authority; tidak ada freeze
authority. Token ini bukan USDT dari Tether, tidak bernilai uang, dan mungkin
terlihat sebagai Unknown Token di Phantom karena belum memiliki metadata nama.
API dan worker tidak menyimpan kunci wallet. Kunci acak untuk pembuatan akun mint
hanya disimpan operator dalam `.devnet/mock-usdt-mint.key` (0600), tidak masuk image.
Pertahankan folder `.devnet` agar restart menggunakan mint yang sama.

Mint yang disiapkan: `9o25cywLXMQ2gFM7EynHQer3C7qExxqWw4FJ32Hg2gQa`.
ATA penerima: `D5ngDGLnnyAHY8ounFfXVtHbSGGiCMNoK35HV7zQhXAD`.
Simulasi RPC Devnet berhasil tanpa broadcast: 27.695 CU, deposit akun 4.043.680
lamports dan fee 10.000 lamports (total estimasi 0,00405368 SOL Devnet).
Tool menghitung ulang biaya dan melakukan simulasi setiap persiapan transaksi.

Pesan transaksi dan signature mint diperiksa sebelum broadcast. Journal lokal
`mock-usdt-submission.json` ditulis sebelum pengiriman; timeout atau restart tidak
memicu resend otomatis. Jika muncul status ambigu, periksa transaksi dan akun di
chain terlebih dahulu; jangan hapus journal untuk mencoba lagi tanpa investigasi.

Status saat implementasi: **menunggu signature pembeli**, aset gateway tetap USDC.
Setelah mint dan kedua ATA finalized, pekerjaan berikutnya adalah memprovisikan
konfigurasi USDT beserta checkpoint awal khusus token, mengaktifkan kedua aset,
dan menguji invoice USDT. Riwayat serta checkpoint USDC harus dipertahankan.

### Mock USDT aktif di gateway (17 Oktober 2026)

Setup mint dan kedua ATA sudah terverifikasi melalui RPC dengan commitment
`finalized`: supply 100 Mock USDT, saldo pembeli 100, saldo penerima 0 sebelum
pengujian pembayaran. Konfigurasi Devnet sekarang `ENABLED_ASSETS=USDT,USDC`.
Watcher membatasi USDT Devnet pada mint proyek yang dipin di `networks.ts`;
USDC tetap memakai mint Circle.

USDT diprovisikan dengan checkpoint awal slot **511954736**, di bawah lock
allocator invoice, sebelum invoice USDT pertama. Pemeriksaan boundary memakai
invoice dan payment attempt khusus aset; riwayat USDC yang ada tidak direset.
Rerun provisioning mempertahankan checkpoint, dan boundary yang hilang setelah
invoice dibuat ditolak. Pengujian database menggunakan schema terisolasi.

Jalankan `pnpm devnet:invoice --usdt` untuk membuka kembali invoice Mock USDT;
`--new` membuat order baru secara eksplisit. Identitas idempotency dan hasil
invoice disimpan terpisah di `.devnet/invoice-usdt.json`, sehingga invoice USDC
sebelumnya tidak tertimpa. Gunakan `pnpm devnet:inspect --usdt` untuk audit.

Invoice pertama: `82beb8c4-42e6-476c-a60e-a0aa3ad8d4a1`, nominal **1.000001
Mock USDT**, masih **pending** ketika dibuat. Buka checkout URL dari CLI, kirim
nominal persis dari token mint proyek pada Phantom Devnet, lalu tunggu finalized.
Jangan ulangi transfer ketika checkout sedang menunggu konfirmasi. Token bisa
bernama Unknown Token di Phantom; verifikasi mint, bukan nama token saja.
Invoice USDC terdahulu tetap paid beserta transfer dan event yang sama.

Webhook delivery tetap nonaktif; event pembayaran USDT baru diharapkan setelah
transfer yang sah. Belum ada klaim pengujian USDT paid pada tahap ini.
