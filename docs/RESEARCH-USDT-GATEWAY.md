# Riset dan rancangan gateway USDT

Acuan urutan implementasi dan checklist produksi: [Roadmap proyek](ROADMAP.md). Scope v1 mengikuti roadmap; alternatif historis pada riset bukan tugas implementasi aktif.

Tanggal: 17 Oktober 2026. Status: riset referensi. Implementasi fondasi lokal sudah dimulai; lihat roadmap untuk scope aktif dan progres. Belum deployment produksi.
Workspace awal kosong. Sasaran: 10–100 pembayaran/hari, beberapa website milik sendiri, tanpa persentase fee processor pihak ketiga.

## Pembaruan arah: satu alamat Solana, USDT dan USDC

Arahan lanjutan pengguna: fokus infrastruktur satu jaringan dan satu alamat penerima, dengan USDT serta USDC. Bagian ini menggantikan rekomendasi alamat unik per invoice dan prioritas jaringan kedua di bawah; bagian sebelumnya dipertahankan sebagai riset alternatif.

Satu owner address dipublikasikan kepada pembeli; siapkan ATA USDT dan ATA USDC milik owner tersebut. Saldo kedua aset tetap terpisah. Terima hanya mint resmi yang diverifikasi dari Tether/Circle, bukan simbol token. Receiving service bersifat watch-only, tanpa seed/private key; perpindahan treasury memakai signing terpisah. Tidak perlu sweep per invoice. Jika receiving address sekaligus treasury, seluruh histori penerimaan terbuka dan akses penandatanganannya harus tetap offline/terisolasi.

Jalur utama: checkout wallet/Solana Pay menyertakan reference unik, nominal dan mint yang ditetapkan server. Verifikasi transfer sebenarnya serta finality; keberadaan reference saja tidak cukup.

Jalur transfer manual/exchange: exact amount unik dapat dipakai sebagai fallback dengan batas berikut:

- Gateway mengalokasikan total payable unik secara atomik untuk kombinasi network+mint+recipient, melintasi semua project. Zekivo tidak membuat kode nominal sendiri.
- Contoh harga 25 USDC menjadi 25.0037 USDC, dengan tambahan ditampilkan sebelum pembayaran. Simpan nominal integer base units dan precision mint; tanpa float atau pencocokan toleransi.
- Pastikan angka invoice A tidak bertabrakan dengan total invoice B yang harga dasarnya berbeda. Gunakan unique reservation atas total akhir, bukan hanya kode tambahan.
- Pertahankan histori reservasi nominal. Expiry invoice tidak membuat nominal aman dipakai ulang: transfer lama dapat datang jauh kemudian. Jika nominal pernah digunakan ulang dan incoming transfer ambigu, jangan auto-fulfill; masuk review atau minta bukti tambahan yang diverifikasi. MVP konservatif tidak menggunakan ulang nominal yang pernah diterbitkan untuk mint/recipient yang sama; jika ruang kode habis, ubah quote atau arahkan ke reference.
- Transfer tanpa reference tidak membuktikan niat/order pembayar. Exact amount hanyalah korelasi praktis dan tetap dapat disalin pihak lain; invoice tidak boleh bisa diklaim ulang dengan tx hash publik. Jangan menawarkan jaminan identitas pembayar dari nominal.
- Pembayaran kurang/lebih, nominal dibulatkan, withdrawal fee dipotong dan partial payment masuk review; jangan memakai >= expected untuk auto-match pada jalur nominal unik.
- Deadline misalnya 30 menit; transfer terlambat tetap dicatat. Jika bisa dipetakan tanpa ambigu ke invoice lama, gunakan late_payment dan kebijakan review quote/order, jangan pindahkan ke invoice baru.
- Unique transfer identity: signature+instruction/inner-instruction index; satu transfer tidak boleh mendanai dua invoice. Commit paid+ledger+outbox dalam transaksi DB.

Sumber tambahan: https://solana.com/docs/payments/accept-payments , https://solana.com/docs/payments/how-payments-work , https://www.circle.com/multi-chain-usdc/solana dan https://docs.solanapay.com/core/transfer-request/merchant-integration .

## Keputusan awal yang disarankan

- Bangun payment processor internal lebih dulu; tiap website punya project, API key, secret webhook, dan ledger terpisah. Merchant publik dan custody dana pihak lain merupakan ekspansi tersendiri.
- Solana USDT sebagai jaringan pertama. TON USDT kandidat kedua, setelah uji asal wallet/exchange pelanggan. TRON opsional jika permintaan pengguna membenarkan biaya resource dan operasionalnya.
- Jika pelanggan mayoritas memakai EVM, evaluasi Arbitrum/Polygon dengan USDT0 dan dukungan withdrawal exchange mereka sebelum menetapkan jaringan kedua. USDT0 harus dicatat eksplisit sebagai representasi aset yang berbeda, beserta kontrak dan risiko lintas chain; jangan menerima token hanya berdasarkan simbol USDT.
- Gunakan alamat unik per invoice untuk transfer manual/exchange. Untuk wallet yang mendukung Solana Pay, satu receiving wallet dengan reference unik lebih hemat dan lebih sederhana. Reference tidak bisa diandalkan pada withdrawal exchange biasa.
- Treasury dipisahkan per jaringan. Satu pemilik/hardware wallet bisa mengontrol beberapa jaringan, tetapi saldo USDT tidak otomatis menyatu lintas jaringan. Tidak ada bridge otomatis pada MVP.
- Docker Compose untuk pengembangan. Azure Container Apps untuk API/worker, PostgreSQL terkelola, Key Vault dan backup untuk produksi. Satu VM Compose merupakan opsi pilot lebih murah, dengan konsekuensi single point of failure dan tanggung jawab patch/backup sendiri.

## Batas yurisdiksi yang perlu diselesaikan

BI menyatakan kripto bukan alat pembayaran yang sah di Indonesia. PBI 23/6/PBI/2021 memuat larangan bagi PJP menerima/memproses virtual currency sebagai sumber dana atau mengaitkannya dengan pembayaran. Jangan menyamakan perdagangan aset kripto dengan izin menerima pembayaran barang/jasa. Negara badan usaha, pelanggan, aktivitas merchant, dan custody menentukan penilaian yang dibutuhkan sebelum produksi. Badan usaha luar negeri tidak otomatis menyelesaikan transaksi yang berada dalam lingkup Indonesia.

Sumber: https://www.bi.go.id/id/publikasi/peraturan/Pages/pbi_230621.aspx dan https://www.bi.go.id/id/publikasi/ruang-media/news-release/Pages/sp_200418.aspx

## Perbandingan jaringan

| Jaringan              | Biaya dan karakter                                                                                                                                            | Implikasi implementasi                                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Solana                | Base fee 5.000 lamports per signature, ditambah priority fee bila digunakan. Account token baru membutuhkan deposit rent-exempt; query ukuran aktual via RPC. | Sponsor SOL terpusat memungkinkan sweep tanpa mengisi SOL ke semua deposit wallet. Rent dapat dikembalikan dengan menutup akun token kosong. Alamat lama tetap perlu dipantau untuk pembayaran terlambat. |
| TON                   | Memerlukan TON untuk gas/storage dan memproses rangkaian message jetton.                                                                                      | Validasi master serta jetton wallet; tangani notification, transaksi gagal/bounce dan transfer tanpa notification. Memo nyaman untuk wallet pendukung, tetapi tidak universal.                            |
| TRON                  | Transfer USDT memakai Energy dan Bandwidth; bila kurang dapat membakar TRX. Aktivasi akun dan dynamic energy memengaruhi biaya.                               | Banyak alamat memerlukan pengelolaan aktivasi, resource dan sweep. Estimasi Energy dan parameter live; jangan menganggap TRC20 selalu paling murah atau gratis.                                           |
| EVM: Arbitrum/Polygon | Fee gas perlu diukur live; representasi USDT/USDT0 dan kontrak perlu diverifikasi.                                                                            | Tooling umum, tetapi sweep EOA biasanya butuh pendanaan native gas ke setiap alamat. Smart contract forwarder menambah beban audit.                                                                       |
| Plasma                | Sponsorship transfer USDT memakai paymaster dengan eligibility dan rate limit.                                                                                | Kandidat eksperimen; tidak dijadikan jaminan semua pembayaran/sweep gratis atau kompatibel dengan semua wallet/exchange.                                                                                  |
| Ethereum mainnet      | Gas berubah dan dapat tidak ekonomis untuk nilai kecil.                                                                                                       | Bukan prioritas volume/nilai transaksi MVP ini.                                                                                                                                                           |

Tidak memberikan angka USD tetap karena harga native coin, priority fee, account state, dan fee withdrawal exchange berubah. Biaya withdrawal exchange berbeda dari network fee.

Sumber jaringan:

- https://tether.to/en/supported-protocols/ — kontrak/mint resmi; sumber allowlist sebelum mainnet.
- https://solana.com/docs/payments/how-payments-work
- https://solana.com/docs/tokens/basics/create-token-account
- https://solana.com/docs/tokens/basics/close-account
- https://developers.tron.network/docs/bandwidth-and-energy
- https://developers.tron.network/docs/paying-for-resources
- https://docs.ton.org/payments/jettons
- https://docs.plasma.to/docs/get-started/why-build-on-plasma/overview
- https://docs.usdt0.to/tutorial/how-to-transfer

## Alamat dan custody

Alamat tetap: biaya operasional rendah, tetapi dua invoice bernilai sama tidak dapat dibedakan dari nominal saja. Gunakan reference/memo yang benar-benar didukung, atau transaksi yang dibuat lewat checkout wallet. Jangan menjadikan digit nominal unik sebagai metode utama karena rounding, partial payment, dan collision.

Alamat unik: pemetaan invoice deterministik, mendukung transfer exchange, dan mengurangi ekspos riwayat receiving address. Sweep ke treasury tetap terlihat di blockchain sehingga bukan anonimitas. Jangan mendaur ulang alamat invoice. Alamat expired tetap dipantau.

Untuk Solana, signer deposit dapat menandatangani transfer token sementara fee payer pusat membayar SOL; setelah token balance nol, akun token dapat ditutup untuk mengambil rent. Penutupan bukan berarti alamat dibuang: deposit berikutnya perlu dikenali dan token account mungkin harus dibuat kembali. Uji perilaku exchange pengirim terhadap pembuatan ATA.

API publik tidak memegang seed/private key. Signer internal terisolasi menerima hanya pekerjaan sweep tervalidasi ke treasury allowlist, dengan limit, audit dan kill switch. Key Vault untuk secret/encryption key; jangan menganggap semua algoritma chain didukung langsung untuk signing oleh Key Vault. Verifikasi Ed25519/secp256k1 dan SDK saat proof of concept. Back up material recovery terenkripsi, simpan salinan offline, dan uji restore. Treasury utama hardware wallet/multisig; hot wallet dibatasi.

## Alur pembayaran

1. Backend Zekivo membuat order dengan harga yang dihitung server, lalu POST /v1/invoices memakai API key dan Idempotency-Key.
2. Gateway menyimpan invoice, merchant/project, order_id, nominal integer, asset, network, expiry dan payment attempt. Bila harga awal fiat, simpan sumber kurs, waktu dan masa berlaku quote.
3. Pembeli memilih jaringan. Gateway mengunci pilihan pada attempt, mengalokasikan alamat/reference, menampilkan nominal, jaringan, QR dan expiry. Perubahan jaringan membuat attempt baru; attempt lama tetap dimonitor agar dua pembayaran tidak menggandakan fulfillment.
4. Watcher mengamati blockchain. Verifikasi jaringan, kontrak/mint, tujuan, jumlah, status eksekusi dan identitas transfer. Simbol token atau tx hash dari browser bukan bukti pembayaran.
5. Catat observed transfer, tunggu finality sesuai chain. Solana: tampilkan detected/confirming, fulfillment setelah finalized sebagai default konservatif.
6. Dalam satu transaksi DB, ubah state invoice, tulis ledger dan transactional outbox.
7. Dispatcher mengirim payment.confirmed ke webhook Zekivo; Zekivo memverifikasi signature dan mencatat event secara idempotent sebelum fulfillment.
8. Sweeper mengumpulkan dana berdasarkan ambang saldo, waktu dan batas fee. Invoice paid tidak menunggu sweep.
9. Reconciler memindai ulang rentang blockchain dan mencocokkan ledger, saldo, sweep serta webhook yang gagal.

Invoice: pending → confirming → paid; expired untuk belum terbayar; partial, overpaid dan late_payment ditangani eksplisit. Transfer memiliki state finality sendiri. Reorg sebelum finality membatalkan observasi sementara. Transaksi salah token/network masuk review jika dapat ditemukan, tanpa janji pemulihan.

Refund adalah transfer keluar baru, perlu tujuan terverifikasi dan persetujuan operator. Jangan otomatis mengirim ke source address karena source dapat berupa hot wallet exchange. Pembayaran setelah expiry masuk review atau kebijakan quote yang ditentukan, bukan hilang.

## Webhook

Event minimum: payment.detected, payment.confirmed, payment.expired, payment.partial, payment.overpaid, payment.late, sweep.failed. Refund event ditambahkan saat modul refund tersedia.

Payload berversi berisi event_id, event_type, occurred_at, project_id, invoice_id, order_id, network, asset identifier, amount_expected/received sebagai string, transfer identifiers, invoice version dan finality. Jangan memakai floating point.

Signature: HMAC-SHA256 atas timestamp + titik + raw body, secret unik per endpoint; timestamp diperbarui dan signature dihitung ulang setiap attempt, event_id tetap sama. Receiver cek timestamp, constant-time comparison dan unique event_id dalam transaksi dengan perubahan order. Event bisa duplikat atau tidak berurutan; API GET invoice menjadi sumber state terkini.

Retry dengan exponential backoff+jitter, misalnya 10 detik sampai 24 jam, lalu dead-letter dan replay operator. Simpan response code, attempt dan next retry. 2xx dianggap diterima. URL webhook HTTPS terdaftar per project, blok private/link-local/metadata IP, validasi DNS saat koneksi dan jangan ikuti redirect untuk mencegah SSRF.

Pola signature, duplicate handling dan asynchronous delivery mengacu pada praktik terdokumentasi: https://docs.stripe.com/webhooks. Ini acuan desain, bukan integrasi atau ketergantungan Stripe.

## Komponen dan penyimpanan

Usulan TypeScript dengan Fastify atau NestJS, PostgreSQL sebagai sumber kebenaran. Satu codebase modular dengan proses API, chain watcher/reconciler, webhook worker dan signer/sweeper terpisah. Postgres job queue/outbox cukup untuk tahap ini; Redis tidak wajib.

Tabel inti: projects, api_keys, webhook_endpoints, invoices, payment_attempts, deposit_addresses, chain_transfers, scan_checkpoints, ledger_entries, sweep_jobs, webhook_events, webhook_deliveries, audit_logs. Unique constraint project+order/idempotency key, chain+transaction+event/instruction index; satu tx bisa berisi beberapa transfer. Isolasi semua query per project.

API minimum: POST /v1/invoices, GET /v1/invoices/:id, list pembayaran dengan pagination, rotasi API key/secret dan replay webhook lewat admin. Checkout hanya mengakses data invoice publik lewat token acak; tanpa API secret.

Scanner harus menyimpan cursor durable, memindai overlap, backfill setelah downtime dan failover RPC. WebSocket/provider webhook mempercepat deteksi, polling/reconciliation memastikan kelengkapan. Untuk volume ini jangan menjalankan full node sendiri. Rate limit RPC ditentukan frekuensi scan dan jumlah alamat, bukan hanya jumlah transaksi. Gunakan dua endpoint independen untuk recovery; verifikasi provider event terhadap chain.

## Docker dan Azure

Development: docker compose untuk API/worker/Postgres dan test merchant webhook; signer memakai key testnet saja.

Produksi yang disarankan: Azure Container Apps API dan worker dengan minimum replica untuk proses watcher kontinu; PostgreSQL Flexible Server dengan backup/PITR sesuai konfigurasi, Key Vault melalui managed identity, Blob Storage untuk export/backup dan Monitor dengan retensi/log cap. Signer tidak punya public ingress. Pisahkan akses DB dan role workload. VM Compose merupakan alternatif pilot setelah kebutuhan availability disepakati.

Budget perencanaan awal USD 80–200/bulan untuk compute, DB, storage/backup, secret dan monitoring, bukan penawaran harga Azure. RPC pihak ketiga, bandwidth besar, HA database, region dan pajak dapat menaikkan biaya. Validasi di Azure Pricing Calculator dengan region/SKU nyata sebelum provisioning. USD 5.000 secara aritmetika setara 25–62,5 bulan pada rentang itu, tetapi masa berlaku kredit, eligibility dan biaya aktual dapat membuatnya jauh lebih pendek. Set budget alert dan periksa expiry subscription.

Kredit Azure tidak membayar SOL/TON/TRX, network fee atau otomatis menutup layanan RPC eksternal. Microsoft menyebut kredit berlaku untuk layanan Azure eligible; pembelian Marketplace/produk non-Azure mungkin tidak tercakup.

Sumber: https://learn.microsoft.com/en-in/microsoft-for-startups/benefits/use-azure-credits dan https://learn.microsoft.com/en-us/azure/container-apps/billing

## Cara mengukur biaya sebenarnya

Biaya bulanan = infrastruktur + RPC + jumlah sweep × biaya sweep + funding/aktivasi alamat + rent yang belum direklamasi + refund + bridge bila dilakukan. Fee pengiriman pembeli/exchange dicatat terpisah.

Pada 10–100 pembayaran/hari, sekitar 300–3.000/bulan. Bila memakai alamat unik sekali pakai, masing-masing umumnya tetap perlu sweep; menjalankan sweeper sekali sehari tidak otomatis mengubah 100 transfer dari 100 alamat menjadi satu transfer murah. Solana bisa membundel instruksi dalam batas ukuran/compute/signature, tetapi perlu pengukuran nyata. Alamat tetap + reference menghindari sweep antar-alamat pada jalur tersebut.

Proof of concept: uji transfer, ATA creation, sweep dan close; ukur lamports/rent per transaksi, waktu finalized, error RPC, serta kompatibilitas wallet dan withdrawal exchange yang benar-benar dipakai pelanggan. Minimum mainnet transfer dipakai hanya setelah testnet lulus dan custody siap; testnet mock token tidak membuktikan semua perilaku USDT mainnet.

## Tahapan pembangunan

1. Tetapkan yurisdiksi, kepemilikan website, nilai transaksi rata-rata, sumber wallet/exchange dan apakah USDT0 diterima.
2. Bangun invoice/API, ledger, merchant isolation, checkout dan webhook dengan chain adapter simulasi.
3. Integrasikan Solana: token allowlist, reference dan alamat unik, scanner/backfill, finality dan rekonsiliasi.
4. Tambahkan signer terisolasi, fee payer, treasury, sweep, rent recovery, backup dan recovery drill.
5. Uji duplicate webhook/transfer, dua invoice sama nominal, partial/late/overpay, salah token, RPC outage, restart saat cursor berjalan, reorg simulasi, sweep retry tanpa pengiriman ganda dan merchant outage.
6. Pilot terbatas setelah penilaian yurisdiksi; ukur biaya aktual sebelum menambahkan TON atau EVM. TRON mengikuti bukti permintaan pengguna.

Keputusan belum final: negara operasi/pasar, kisaran nilai invoice, wallet/exchange pembeli, masa berlaku kredit Azure dan toleransi downtime. Tidak ada key, akun cloud, container produksi atau dana yang dibuat/dipindahkan selama riset.

## Lingkungan testing dan dashboard (arahan lanjutan)

Testing pengembangan tidak membutuhkan dana nyata. Gunakan tiga lingkungan terisolasi:

- Localnet: local Solana validator di Compose, mint SPL mock USDT/USDC dengan precision sesuai konfigurasi produksi, SOL lokal, wallet fixture dan script pembayaran. Uji otomatis invoice → transfer → finality → outbox → webhook → fulfillment, termasuk restart, duplicate dan nominal salah. Token mock bukan token issuer resmi dan tidak membuktikan semua perilaku mainnet.
- Devnet: uji integrasi RPC publik dan wallet nyata dalam mode developer. Circle menyediakan faucet USDC untuk Solana Devnet. Untuk USDT gunakan mint mock yang ditandai jelas; riset ini belum menemukan faucet Solana USDT resmi Tether yang dapat dijadikan ketergantungan. Solana Testnet terutama untuk pengujian validator; Devnet lebih sesuai pengembangan aplikasi.
- Mainnet: produksi dengan mint resmi. Database, API key, webhook secret, receiving wallet dan allowlist token dipisahkan dari localnet/devnet. Tidak ada auto-fallback dari devnet ke mainnet. Test payment tidak boleh mengubah order live.

Sumber: https://solana.com/docs/rpc , https://solana.com/docs/references/solana-cli , https://faucet.circle.com/ .

Dashboard MVP mencakup login admin + MFA, overview penerimaan per token dan environment, daftar/detail invoice dan transfer, partial/late/overpaid/unmatched review, project dan API key, konfigurasi webhook beserta delivery log/replay, receiving address dan saldo per token, kesehatan RPC/scanner/checkpoint, serta audit log. Nominal invoice paid bukan selalu saldo wallet saat ini; tampilkan metrik terpisah. Private key/seed tidak ditampilkan pada dashboard. Aksi sensitif dibatasi role, tercatat dan memerlukan autentikasi ulang sesuai risiko. Test payment hanya tersedia pada lingkungan sandbox.

Checkout pembeli mencakup pemilihan USDT/USDC, label Solana, nominal persis dan tombol copy, QR/payment link, alamat, countdown, status confirming/paid/expired serta instruksi jika nominal tidak sesuai. Mobile mengutamakan tombol buka wallet dan copy; desktop mengutamakan QR. Keduanya tetap menyediakan fallback. Dashboard desktop menggunakan tabel/filter; mobile menggunakan daftar kartu dan detail yang dapat dibuka. Gunakan layout responsif, target sentuh nyaman, fokus keyboard, kontras dan status berbasis teks selain warna. Uji breakpoint mobile/tablet/desktop, alamat panjang, reconnect, dan status pembayaran dari server.
