# Kesiapan staging Devnet

Target berikutnya adalah staging Devnet. Dokumen ini tidak memberi izin aktivasi
Mainnet/produksi, transfer dana nyata atau publikasi. Konfigurasi production dan
mainnet-beta tetap ditolak. Repository: `git@github.com:afuzapratama/zekivo-pg-crypto.git`. Link telah diberikan operator; workspace lokal belum menjadi Git repository dan belum ada push pada tahap pemeriksaan. Pipeline deployment Azure belum dibuat.

## Kondisi saat ini

- USDC faucet dan Mock USDT Devnet pernah finalized → paid, ledger+confirmed.
- Dashboard, Entra login, API keys/rotasi, webhook settings, review, notifikasi,
  monitoring dan pencatatan refund tersedia. Ada scope internal semua project;
  filter project bukan pembatasan otorisasi per project.
- Outbox: confirmed/expired/partial/overpaid/late/review_required. Delivery HTTPS
  merchant Devnet belum dibuktikan; Compose Devnet tetap WEBHOOK_DELIVERY=false.
- Uji wallet refund manual Devnet dilewati sesuai keputusan operator. Jangan
  melabelinya lulus; tidak dijadikan gate untuk staging.

## Urutan sebelum staging dibuka ke penguji

1. Verifikasi login/logout dan fresh auth Entra aktual; tetapkan MFA/Conditional
   Access serta identitas/role penguji. Putuskan apakah semua penguji internal
   boleh membaca seluruh project; implementasikan grants sebelum memberi akses
   bila pembatasan per project diperlukan.
2. Tentukan domain HTTPS staging dan endpoint receiver merchant staging. Pilih
   identitas project dan signing secret tersendiri; secret di backend receiver.
   Jangan memakai contoh receiver sandbox sebagai backend production.
3. Deploy resource staging Devnet terpisah: API/web/worker/monitor, PostgreSQL,
   secret injection, HTTPS, database tertutup, worker tidak scale-to-zero.
   Inventaris subscription/region/budget/kredit lebih dulu; belum provision Azure.
4. Terapkan migration hingga 016 sebelum update aplikasi. Cek health/ready,
   assertion genesis/mint/recipient dan koneksi tanpa mencetak secret. Backup dan
   restore drill ke DB terpisah sebelum menyimpan order pengujian yang penting.
5. Daftarkan endpoint HTTPS sebelum membuat invoice uji baru, lalu aktifkan delivery
   hanya pada konfigurasi staging yang disepakati. Event historis tidak otomatis
   dikirim ke endpoint baru. Compose Devnet sekarang belum diubah untuk ini.
6. Uji satu pembayaran tiap aset, review/partial/expiry, retry/timeout/replay dan
   urutan review lebih baru sebelum confirmed. Bukti harus sampai receiver dengan
   HMAC raw body/timestamp sah dan fulfillment tepat satu; cocokkan order/aset/
   nominal dengan pesanan backend. Browser/redirect bukan sumber kebenaran.
7. Jalankan matriks gangguan RPC/429/backlog/restart/two-worker/DB outage,
   load 100 invoice, manipulation/SSRF/CSRF/session/key/sandbox isolation.
   Sebagian kasus sudah punya unit/integration tests; belum seluruh gate teruji.
8. Verifikasi alert SMTP/Telegram, external uptime di luar host/DB, budget alert,
   runbook pause invoice/recovery dan coverage rekonsiliasi. Monitor sekarang
   berbagi host/DB; verifikasi batch paid bukan rekonsiliasi seluruh treasury.

## Bukti yang dicatat per pengujian

Tanggal, lingkungan/cluster, migration/image, invoice/event/delivery ID, status
ledger, attempt response yang disanitasi, receipt dan fulfillment count. Jangan
merekam API key, CSRF/session, Entra secret, signing key atau seed phrase dalam
log, screenshot, issue maupun artefak pipeline.

## Pekerjaan yang dapat dilanjutkan tanpa link GitHub

Tes keandalan dan keamanan, kontrak payload/receiver, runbook, desain resource
staging/Bicep dan inventaris kebutuhan. Setelah link diberikan, periksa akses dan
keadaan repo dahulu; jangan menimpa histori atau menganggap izin deploy live.
GitHub diperlukan untuk menghubungkan source/pipeline, bukan untuk membuktikan
webhook lokal benar.

## Data awal dari operator untuk Azure staging

Kirim nilai non-secret berikut:

- Azure Subscription ID yang mendapat kredit startup dan Tenant/Directory ID
  subscription itu. Tenant dapat berbeda dari tenant login dashboard; cocokkan
  secara eksplisit. Jangan mengirim password atau access token.
- Region yang tersedia pada subscription (atau gunakan Southeast Asia bila
  tersedia), dan resource group existing jika sudah ada. Jika belum, usulan nama
  `rg-zekivo-pg-staging`; nama resource final bergantung ketersediaan.
- Domain staging yang ingin digunakan serta akses DNS-nya. Bisa mulai dari URL
  HTTPS bawaan Container Apps sebelum custom domain; URI callback Entra harus
  mengikuti URL staging final.
- Batas anggaran bulanan staging dan tanggal berakhir kredit startup.

Akses awal: Azure CLI 2.91.0 sudah dipasang pada mesin EndeavourOS melalui
`uv tool install --python 3.12 azure-cli`, executable `~/.local/bin/az`, dengan
environment Python terisolasi. Login Azure sudah dilakukan dan account aktif diverifikasi. Operator dapat
menjalankan `az login` secara interaktif pada terminal mesin ini atau memakai
Azure Cloud Shell. Jangan kirim
kode login/device code atau client secret lewat chat. Provisioning memerlukan
hak pada resource group/subscription; konfigurasi role assignment/federated
identity mungkin memerlukan administrator yang memiliki izin terkait.

Rancangan layanan: Container Apps untuk web/API/worker/monitor, Container Registry,
PostgreSQL Flexible Server, Key Vault dan Log Analytics. GitHub Actions memakai
OIDC ke Azure; identity deployment terpisah dari App Registration login dashboard.
Belum ada SKU/biaya final atau jaminan region sebelum inventory subscription.
Credential aplikasi, database, RPC, SMTP/Telegram dan encryption key disimpan
melalui secret storage, tidak dimasukkan ke repository. `.env.devnet` tidak boleh
dipush. Resource dan database staging dipisahkan dari instance lokal.

Sumber implementasi:
[Container Apps GitHub Actions](https://learn.microsoft.com/en-us/azure/container-apps/github-actions),
[GitHub OIDC Azure](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-azure),
[managed identity image pull](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity-image-pull).

## Hasil inventory Azure — 17 Oktober 2026

Bicep CLI 0.48.1 juga sudah dipasang dan diverifikasi.

- Subscription aktif `Azure subscription 1`, status Enabled. Identitas login
  memiliki Owner pada subscription; role assignment dapat dibaca.
- Southeast Asia tercantum pada katalog Container Apps managed environment dan
  PostgreSQL Flexible Server. Ini bukan jaminan quota/capacity atau provisioning
  SKU; perlu validasi pada tahap deployment.
- Microsoft.App: Registered. Microsoft.DBforPostgreSQL dan
  Microsoft.ContainerRegistry serta Microsoft.KeyVault: NotRegistered saat pemeriksaan. Registrasi provider
  yang belum aktif diperlukan sebelum provisioning layanan terkait.
- Microsoft.OperationalInsights: Registered.
- Subscription sudah memiliki resource group proyek lain. Resource staging baru
  diusulkan `rg-zekivo-pg-staging`; jangan memakai atau mengubah resource group
  proyek lain.
- Repo GitHub sudah diketahui dan SSH dapat dibaca, tetapi workspace ini belum
  diinisialisasi Git/push. Kredensial lokal tidak boleh ikut initial commit.
- Budget staging ditetapkan operator US$200/bulan, kredit berakhir Juli 2027 (tanggal persis belum diberikan). Saldo kredit $5000 dari konteks
  operator belum diverifikasi terhadap billing; tidak diasumsikan saldo tersisa.
- Registrasi provider PostgreSQL/Container Registry/Key Vault sudah diminta setelah scope staging ditetapkan. Belum ada resource group, resource, role assignment,
  GitHub federated credential atau deployment yang dibuat pada pemeriksaan ini.

`infra/azure/staging.config.example.json` menyimpan usulan scope non-secret,
bukan template ARM/Bicep yang dapat dideploy. Budget diset US$200/bulan; expiry dicatat `2027-07` tanpa mengarang tanggal persis. URL HTTPS bawaan Azure dipilih operator sehingga
custom domain tidak menjadi syarat awal; callback Entra disesuaikan setelah URL
staging aktual tersedia.

Budget Azure adalah pemantauan/alert pengeluaran, bukan hard spending cap. Nilai US$200 adalah batas rancangan; biaya SKU/region dan penggunaan harus divalidasi sebelum provisioning.

Rancangan implementasi kini tersedia di [infra/azure/README.md](../infra/azure/README.md):
foundation, workload, manual bootstrap/migration job dan budget. Compile Bicep
lulus; foundation What-If Azure Succeeded tanpa apply. Estimasi all-active 31 hari
US$197.44 dengan allowance/contingency; margin sempit dan bukan hard cap. Workspace
sudah Git init/origin SSH untuk initial import. Secret scanning/push protection
repo public aktif; workflow code/infra tidak memiliki akses deploy Azure.

### Status aktual 17 Oktober 2026

Inventory/rancangan di atas adalah catatan sebelum apply. Foundation dan budget
kini Succeeded di `rg-zekivo-pg-staging`; database privat sudah dibootstrap dan
migrasi selesai. Key Vault menyimpan kredensial terpisah; bootstrap identity
sementara dicabut setelah tugas selesai. GitHub main dilindungi PR + required
check; PR #7 merged setelah CI lulus. Azure continuous deployment/OIDC belum ada.
API readiness cloud HTTP 200 dan pembuatan invoice USDC/Mock USDT berhasil.
Rincian deployment dan pengujian yang masih menunggu ada di
[ROADMAP.md](ROADMAP.md#azure-staging-mulai-diterapkan--17-oktober-2026).

URL staging (Devnet saja):

- Web: https://zkpgstg-web.nicebay-76e1d13a.southeastasia.azurecontainerapps.io
- API: https://zkpgstg-api.nicebay-76e1d13a.southeastasia.azurecontainerapps.io

Callback Entra web Azure telah ditambahkan; localhost dipertahankan. Login
operator nyata, transfer Devnet pada staging, webhook HTTPS eksternal, restore,
load/security dan RPC failover belum dinyatakan lulus. Mainnet tetap off dan
`WEBHOOK_DELIVERY=false` sampai endpoint integrasi disiapkan.

Web dan API revision Healthy; HTTPS login HTTP 200 diverifikasi dengan Chromium.
Dashboard tanpa sesi redirect ke login, admin API menolak anonymous 401. Awal login
Microsoft lewat web mengembalikan 303 ke Microsoft dan cookie Secure; operator
masih perlu menyelesaikan login nyata untuk memverifikasi callback/sesi/allowlist.

### Pembaruan 18 Oktober 2026

PR #9 (`2d0618d`) sudah diterapkan ke staging setelah CI lulus. Migration job
017/018 Succeeded; checkout light, ikon USDT/USDC dan invoice USD v2 tersedia.
API menggunakan CoinGecko Demo dengan secret Key Vault khusus API dan cache
PostgreSQL. Invoice USD dan replay idempotency diverifikasi di URL publik;
smoke tidak mengirim dana. Lihat catatan rilis di ROADMAP.md untuk image digest.
Azure deployment masih manual; CI GitHub belum melakukan deploy otomatis.
