# Dokumentasi dan playground lokal

Buka [dokumentasi](http://localhost:3100/docs) dan [playground](http://localhost:3100/docs/playground) setelah `pnpm local:up`. Service `local-tools` tambahan berjalan hanya pada jaringan Compose; tidak membuka port host. API/worker gateway tetap watch-only. Pengiriman mock dijalankan proses testkit terpisah dengan signer fixture localnet.

## Alur penggunaan

1. Pilih mock USDT/USDC, nominal positif sampai 999.999999, order ID opsional, expiry 60–3600 detik dan quote alternatif bila perlu. Project dikunci ke Local sandbox.
2. Generate invoice. Request ID menjadi idempotency key; **Ulang request yang sama** memakai payload/key yang sama. Order ID diberi prefix playground untuk membatasi akses helper. Invoice yang sama tidak dibuat dua kali ketika request diulang.
3. Buka checkout QR. Halaman checkout sebenarnya dapat tetap terbuka di tab lain.
4. Pilih satu skenario per invoice: Bayar tepat, Transfer manual tanpa reference, Bayar kurang, atau Bayar lebih. Kurang/lebih berbeda satu base unit dari nominal persis dan menyertakan reference.
5. Tunggu runner dan validator. Timeline menampilkan status action, transfer finalized/disposition, event outbox, delivery dan receipt merchant dengan hasil verifikasi signature. Status paid hanya berasal dari scanner/settlement.
6. Refresh tetap memuat invoice terakhir melalui ID di storage browser; kredensial merchant/control token tidak disimpan di browser. Checkout URL disamarkan pada panel JSON, tetapi tersedia melalui tombol checkout. Perlakukan link tersebut sebagai capability.

Gunakan invoice baru untuk skenario berikutnya. Satu invoice playground hanya menerima satu action pengiriman melalui helper. Ini tidak membatasi pencocokan pembayaran ganda pada gateway; CLI/test chain tetap bisa menguji kasus tersebut secara terencana.

## Keandalan dan pembatasan

Migration 006/007 menyimpan request_id, status action dan signature dengan constraint satu action per invoice serta satu action pending secara global. Retry ID yang sama membaca record yang sudah ada; ID lain pada invoice yang sudah memiliki action ditolak. Runner restart menandai pekerjaan tertinggal sebagai unknown setelah memperoleh singleton advisory lock. Timeout/broadcast yang belum pasti tidak otomatis mengirim ulang.

`completed` berarti CLI mengembalikan transaksi finalized, bukan bukti merchant fulfillment. `pending` berarti proses belum selesai; `unknown` berarti hasil belum dapat dipastikan dan harus diperiksa terhadap chain/timeline. Invoice paid dan receipt merchant tetap bukti berbeda. Jangan menghapus record action untuk memaksa retry.

Helper hanya mengakses invoice prefix playground dalam project fixture local/localnet. Konfigurasi runner menolak Devnet, Mainnet dan RPC non-lokal. Proxy web memerlukan LOCAL_PLAYGROUND=true, APP_ENV=local, SOLANA_CLUSTER=localnet, hostname loopback dan Origin sama untuk POST; body dibatasi dan path allowlist. Endpoint ini bukan hosted/public sandbox. API key fixture/control token tetap server-side; tidak boleh memakai kredensial live.

Input dibatasi, satu pengiriman dijalankan pada satu waktu, dan invoice API tetap menerapkan rate limit. Helper lokal belum mempunyai session/project isolation per pengguna; fitur tersebut menunggu F6-08. Simulasi merchant gagal serta tombol replay webhook belum ada di UI (F6-06); API replay dan kontrol receiver CLI sebelumnya tetap tersedia di [WEBHOOKS.md](WEBHOOKS.md).

## Native tanpa container aplikasi

Setelah database/validator/seed siap sesuai README, jalankan migration terbaru. Tambahkan LOCAL_PLAYGROUND_TOKEN ke `.env` lokal dari contoh, lalu:

```sh
pnpm local:playground
```

Di terminal web, berikan env secara eksplisit karena Next berjalan dari apps/web dan tidak membaca `.env` root seperti script API:

```sh
LOCAL_PLAYGROUND=true APP_ENV=local SOLANA_CLUSTER=localnet \
LOCAL_PLAYGROUND_TOKEN=local_playground_control_only \
LOCAL_PLAYGROUND_URL=http://127.0.0.1:4300 \
pnpm --filter @zekivo/web dev
```

Runner native memakai port 4300 loopback dan API 4100. Jangan menjalankan runner native bersamaan dengan runner Compose pada database yang sama; singleton lock menolaknya. Jangan mengekspos helper melalui tunnel publik. Tidak membutuhkan private key wallet nyata.

## Bukti pengujian

Test integrasi PostgreSQL memeriksa isolasi invoice, batas input, kredensial, request idempotent dan hasil broadcast unknown tanpa pengiriman kedua. Suite browser memeriksa tampilan tiga viewport, axe, generator, timeline serta referensi OpenAPI dari gateway. Suite chain mencakup generate → buka checkout → klik Bayar tepat → finalized → signed webhook → refresh, serta Bayar kurang → partial tanpa event confirmed.

```sh
pnpm test:checkout
pnpm test:checkout:chain
```

Jalankan test chain serial dengan test lain yang menggunakan fault controls receiver. Artefak browser di test-results diabaikan Git/Docker. Screenshot QA memakai fixture sintetis di test runner, bukan route simulasi status pada produk.
