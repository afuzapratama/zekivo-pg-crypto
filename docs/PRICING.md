# Adapter harga dan cache

Fondasi harga USD → USDT/USDC sudah tersedia untuk localnet/Devnet. Endpoint invoice USD tersedia pada `POST /v2/invoices`; API invoice v1 tetap menerima nominal token. Rancangan
integrasi lengkap ada di [USD-PRICING-AND-QUOTES.md](USD-PRICING-AND-QUOTES.md).

## Konfigurasi dan uji operator

`.env.devnet` dibaca langsung oleh CLI di host, bukan dikirim ke browser:

```dotenv
PRICING_PROVIDER=coingecko-demo
COINGECKO_DEMO_API_KEY=<key Demo>
PRICING_CACHE_TTL_SECONDS=60
PRICING_MAX_AGE_SECONDS=180
PRICING_MONTHLY_BUDGET=9000
```

```sh
pnpm pricing:inspect --devnet
```

Perintah mengambil satu batch USDT/USDC, menampilkan harga/waktu sumber dan contoh
konversi US$25,83, lalu membaca lagi untuk membuktikan cache (`cached: true`).
Tidak membuat invoice, memindahkan dana, mengubah status paid atau menambahkan
kode unik. Field `convertedAmount` adalah hasil pembulatan sebelum penyesuaian
unik invoice, bukan nominal instruksi pembayaran untuk pelanggan.

CLI memerlukan migrasi `017_market_prices.sql` pada database yang dipilih.
Migrasi sudah diterapkan di localnet, Devnet lokal dan database test saat tahap
ini. Key sudah diuji dari `.env.devnet`; key tidak ditampilkan dalam hasil/log.
Konfigurasi Demo belum dipasang di Azure Key Vault/workload Azure. Compose saat
ini juga belum meneruskan key ke API/worker pada deployment Devnet lama. API lokal kini memakai provider fixture untuk invoice USD; penerusan Demo key ke API Devnet perlu konfigurasi eksplisit.

Untuk fixture tanpa `.env` host, gunakan environment lokal eksplisit:

```sh
APP_ENV=local SOLANA_CLUSTER=localnet \
DATABASE_URL=postgres://gateway:localdev@127.0.0.1:55432/gateway \
PRICING_PROVIDER=fixture pnpm pricing:inspect
```

Jika `.env` sudah dibuat dari `.env.example` dan dikonfigurasi, cukup gunakan
`pnpm pricing:inspect`. Fixture memakai rate 1 USD/token untuk pengujian saja;
bukan fallback saat provider pasar gagal. Production/mainnet ditolak konfigurasi.

## Cara kerja

- CoinGecko Demo dipanggil lewat HTTPS dan header server-side; host/path/ID aset
  tetap. Redirect ditolak agar credential tidak diteruskan ke host lain.
- ID dipin ke `tether` dan `usd-coin`. Dua aset diambil dalam satu request.
- Reviver source context JSON pada Node 24 mempertahankan angka asli, termasuk
  angka di luar presisi Number, sebelum dinormalisasi menjadi decimal string.
- Timeout lima detik, batas response 64 KiB; payload/URL/key tidak dimasukkan
  ke pesan error. Kedua aset, timestamp dan rate harus valid.
- Umur sumber maksimal 180 detik, toleransi clock ke depan 30 detik. Harga di
  luar 0,99–1,01 USD/token menolak penerbitan snapshot baru (breaker awal).
- Cache on-demand 60 detik di PostgreSQL, dibatasi juga umur data sumber.
  Tidak ada polling background. Snapshot yang tidak valid/kedaluwarsa tidak
  dipakai sebagai fallback.
- Advisory lock PostgreSQL + single-flight dalam proses menggabungkan request
  bersamaan dari beberapa instance. Batas menunggu lock 6,5 detik. Lock dilepas
  setelah sukses maupun gagal; connection yang tidak bisa melepas lock dibuang.
- Error upstream memicu cooldown bersama 30 detik. Satu request gagal tetap
  dihitung ke budget lokal; tidak ada retry jaringan implisit.
- Pemakaian dicatat sebelum memanggil provider pada `market_price_usage`, per
  fingerprint credential dan bulan UTC. Cache disimpan di `market_price_cache`.
  Credential asli tidak disimpan dalam kedua tabel.
- Batas awal 9.000 request/bulan menyisakan ruang terhadap paket Demo 10.000.
  Counter ini hanya untuk database/key ini: **bukan saldo resmi akun CoinGecko**.
  Key lain, pemanggilan manual dan deployment dengan database lain tidak ikut
  dihitung. Alokasikan budget lintas lingkungan dan cek dashboard provider.
  Mengganti key/database juga tidak menambah kuota paket akun sebenarnya.
- Pembacaan cache yang valid tidak mengonsumsi budget provider. Error atau
  kuota habis menolak refresh baru; tidak mengubah invoice/ledger yang ada.

Rate pasar global terpisah dari mint token Solana yang divalidasi watcher.
Mock USDT Devnet tetap token uji; referensi USD bukan harga pasar token mock itu.

## Mengapa belum Redis

Untuk volume awal 10–100 invoice/hari, PostgreSQL yang sudah tersedia cukup untuk
cache kecil dua aset serta lock/counter bersama. Ini menghindari satu layanan,
konfigurasi kredensial dan operasi persistensi tambahan. Tidak ada ketergantungan
pada container Redis milik proyek lain.

Redis dapat ditambahkan jika trafik atau kebutuhan queue meningkat. Audit dan
batas pemakaian durable tetap perlu dirancang: kehilangan cache atau restart
Redis tidak boleh menghapus penghitungan kuota dan membuka akses provider tanpa
batas. Estimasi biaya Redis di Azure harus dihitung sebelum deployment baru.

## Verifikasi 18 Oktober 2026

- 33 pengujian pricing mencakup decimal/rounding, presisi JSON, data invalid,
  timestamp, depeg, response besar, redaksi error, TTL, quota/cooldown,
  pergantian bulan UTC, isolasi caller dan single-flight lintas instance.
- Seluruh suite backend: **251 tes / 31 file lulus**. ESLint dan TypeScript lulus.
- Uji nyata CoinGecko di Devnet lokal berhasil: pembacaan pertama dari provider,
  pembacaan kedua dari PostgreSQL tanpa request provider tambahan. Satu batch
  menghasilkan kedua harga; contoh konversi USD terhitung terpisah per aset.
- Fixture lokal juga menghasilkan cache miss kemudian hit tanpa jaringan.

## Berikutnya

Schema USD/v2 → snapshot quote/payment attempt yang immutable → reservasi kode
unik → create invoice/idempotency → checkout USD/token → webhook versioned.
Cache harga ini tidak menggantikan snapshot quote: TTL cache 60 detik dan masa
berlaku quote pembayaran adalah dua hal berbeda. Belum membeli paket provider.

Pembaruan: quote invoice USD, harga asli dan pilihan aset kini tersimpan melalui migration 018. Checkout dan playground lokal menggunakan kontrak tersebut; lihat INVOICE-API.md. Azure staging sudah diperbarui pada 18 Oktober 2026; API memakai CoinGecko Demo melalui Key Vault. Migrasi 017/018 dan smoke invoice USD lulus. Rincian rilis ada di ROADMAP.md.
