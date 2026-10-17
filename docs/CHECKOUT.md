# Checkout sandbox

Checkout tersedia pada `/pay/<checkout_token>` dari `checkout_url` response create invoice. Jalankan `pnpm local:up`, buat invoice melalui API merchant sesuai README, lalu buka URL tersebut. Halaman utama masih status development; generator invoice tersedia pada /docs/playground, dashboard admin belum tersedia.

## Uji lokal

1. Buat invoice USDT atau USDC melalui `POST /v1/invoices`; simpan `id` dan buka `checkout_url`.
2. Halaman menampilkan aset invoice, nominal dasar/nominal persis, jaringan, QR Solana Pay, alamat receiving owner dan mint.
3. Jalankan `docker compose exec api pnpm local:pay <invoice-id>` untuk membayar dengan fixture mock token. Untuk transfer tanpa reference, tambahkan `--manual`.
4. Setelah finalized dan diproses worker, polling menampilkan paid. Webhook tetap diproses terpisah; status halaman bukan bukti fulfillment merchant.
5. Pada invoice baru, kirim nominal kurang untuk menguji review: `docker compose exec api pnpm local:pay <invoice-id> 1`. Transfer ber-reference dapat dikaitkan dengan invoice; transfer manual salah nominal bisa menjadi unmatched dan tidak otomatis muncul di checkout tertentu.

QR mengikuti [Solana Pay transfer request](https://docs.solanapay.com/spec): recipient berupa owner address, amount berupa nominal persis, `spl-token` mint, serta reference invoice. URI tersebut tidak menentukan cluster; wallet harus memakai jaringan yang benar. Localnet memerlukan wallet yang terhubung ke validator lokal; CLI adalah jalur pengujian yang tersedia tanpa konfigurasi wallet. Kompatibilitas wallet nyata masih harus diuji pada fase Devnet.

## Akses dan data

- `GET /v1/checkout` memakai header `X-Checkout-Token`, tanpa API key merchant. Token acak 256-bit hanya membuka proyeksi baca satu invoice pada environment/cluster aplikasi.
- Proyeksi tidak memuat project ID, order ID, API key, webhook atau checkout token/URL. Token tidak memberikan akses ke API merchant, mengubah harga atau menandai paid. Token dapat memilih quote aset yang telah disetujui merchant melalui endpoint pemilihan aset.
- Browser memakai proxy same-origin `GET /api/checkout` dengan header token. `API_INTERNAL_URL` hanya digunakan server web, default `http://127.0.0.1:4100`; Compose mengaturnya ke `http://api:4100`. Tidak ada API key di browser.
- API/proxy memberi Cache-Control no-store. Halaman checkout memakai no-referrer, noindex/nofollow serta frame denial. Tidak memakai analytics atau aset eksternal.
- Logger API menyembunyikan header token. Next development mengabaikan log incoming request `/pay/...` dan tidak meneruskan console browser ke terminal. URL `/pay/<token>` tetap merupakan kredensial baca: jangan bagikan. Sebelum hosting, konfigurasi redaksi path pada ingress/APM/access logs; F5-06 tetap terbuka sampai lapisan infrastruktur diverifikasi.

## Perilaku UI

Polling normal setiap 3 detik, 15 detik setelah paid; kegagalan memakai backoff sampai 30 detik. Request memiliki timeout dan dibatalkan saat halaman dilepas. Browser offline segera menyembunyikan instruksi kirim; online atau tab kembali terlihat memicu pembacaan status baru. Response request lama yang dibatalkan tidak dapat menimpa response terbaru. Countdown mengacu pada server_time, mengurangi durasi request secara konservatif, dan menghitung sisa waktu memakai performance.now() agar perubahan jam perangkat tidak memperpanjang invoice. Saat hitungan mencapai nol, halaman menghentikan instruksi kirim tetapi tetap menunggu status server, termasuk transfer tepat waktu yang baru selesai diindeks.

Instruksi kirim juga disembunyikan saat koneksi gagal, payment disabled, confirming, paid atau ada review transfer. Tombol copy mempunyai pesan kegagalan dan teks dapat dipilih manual. Rincian invoice dapat dilipat pada mobile agar QR lebih cepat terlihat; desktop menampilkan rincian terbuka. Countdown tidak diumumkan ulang tiap detik oleh screen reader. Setelah tombol wallet diklik, bantuan transfer manual ditampilkan tanpa mengklaim bisa mendeteksi apakah aplikasi wallet terpasang. Kegagalan rendering QR tetap menyediakan link wallet dan copy manual. Tidak ada redirect otomatis atau tombol mark paid.

Invoice tanpa payment_options tetap memiliki satu aset. Merchant dapat menyetujui dua quote berbeda agar pembeli memilih USDT/USDC di checkout. Pergantian menyimpan seluruh attempt, tidak mengubah deadline atau membuat invoice/order baru. Kontrak dan contoh: [PAYMENT-ATTEMPTS.md](PAYMENT-ATTEMPTS.md). Status confirming ditampilkan bila server menyediakannya, tetapi scanner saat ini finalized-only.

## Uji browser yang dapat diulang

Dengan Docker lokal sudah berjalan:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install --only-shell chromium
pnpm test:checkout
pnpm test:checkout:chain
```

Jika Linux belum memiliki library browser, ikuti [petunjuk Playwright](https://playwright.dev/docs/browsers) untuk memasang dependensi OS. Browser tidak dimasukkan ke image API/worker/web produksi.

`test:checkout` menjalankan fixture UI pada Chromium desktop 1440×1000, mobile 390×844, dan layar sempit 320×740. Data fixture hanya digunakan oleh test runner melalui intercept HTTP; tidak ada route simulasi status pada aplikasi. Test memeriksa overflow alamat/mint, keyboard/fokus, ukuran tombol, audit axe WCAG A/AA, decode QR menjadi URI yang sama dengan link wallet, clipboard berhasil/gagal, offline/reconnect, reload paid, expiry dan recovery pembayaran tepat waktu, review/confirming/disabled, link invalid, error server, fallback wallet, perubahan jam perangkat dan kegagalan canvas QR.

`test:checkout:chain` mencakup test **localnet nyata** per aset serta pergantian aset: create invoice via API merchant di sisi test runner → buka checkout pada browser → bayar mock token via CLI Docker → tunggu finalized/paid → reload → periksa receiver signed webhook dan fulfillment satu kali. USDT menggunakan reference; USDC menggunakan manual exact amount. Test menolak environment selain local/localnet; tidak mengakses dana nyata dan tidak mereset data. Invoice/transfer bukti pengujian disimpan seperti smoke test lain. Jalankan serial terhadap test lain yang mengubah fault mode receiver.

Default target web `http://127.0.0.1:3100`. Playwright memakai layanan yang sudah berjalan; bila belum ada, ia menjalankan build Next production yang sudah dibuat dengan `pnpm build`. Untuk server lokal lain gunakan `CHECKOUT_BASE_URL=http://127.0.0.1:3101 pnpm test:checkout`. Hanya loopback diizinkan. API/receiver/CLI test chain tetap menargetkan Compose lokal 4100/4200. API key/control token fixture tidak dikirim melalui browser.

Screenshot/output test ada di `test-results/ui` dan `test-results/chain`; laporan HTML ada di `playwright-report`. File ini diabaikan oleh Git. Trace/network recording dimatikan karena bisa memuat URL token. Jangan mempublikasikan artefak dari test chain tanpa redaksi URL. Pipeline CI menambahkan suite fixture browser setelah build; suite chain perlu validator Docker dan dijalankan lokal.

Bukti dan batasan hasil saat ini dicatat di [CHECKOUT-QA.md](CHECKOUT-QA.md). Pengujian perangkat fisik, Safari/iOS/WebKit dan aplikasi wallet nyata masih menunggu fase Devnet. Pergantian aset diperiksa melalui test domain, browser dan localnet; hasil terbaru dicatat di roadmap.

Jika checkout Docker hanya berhenti pada layar memuat, periksa console browser dan log web. Next development harus mengizinkan origin loopback yang digunakan browser. Konfigurasi repository sudah memasukkan 127.0.0.1 dan IPv6 loopback pada allowedDevOrigins; localhost diizinkan oleh Next. Gunakan image terbaru setelah perubahan konfigurasi. Jangan membuka wildcard origin development untuk mengatasi masalah ini.
