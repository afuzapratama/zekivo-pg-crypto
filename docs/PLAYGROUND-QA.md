# QA dokumentasi dan playground — 17 Oktober 2026

Dokumentasi tersedia pada /docs dan playground pada /docs/playground di Docker lokal port 3100. Screenshot diperiksa pada desktop, mobile dan layar 320 px; audit axe A/AA tidak menemukan pelanggaran yang diuji. Bukti fixture sintetis: [desktop](qa/playground-desktop.png), [mobile](qa/playground-mobile.png). Ini bukan bukti perangkat fisik atau jaringan Devnet.

- Unit/integrasi PostgreSQL: 90 test lulus, termasuk lima test isolasi/helper, idempotency dan unknown broadcast tanpa resend. Test perbandingan expiry mempertahankan presisi millisecond Date; perubahan aset tetap tidak memperpanjang deadline.
- Suite UI fixture: 45 test lulus. Setelah perbaikan nama aksesibel dropdown aset dan penyempurnaan layout/pesan status, enam test docs/playground di Docker diulang dan lulus pada tiga viewport; dropdown USDT/USDC, overflow, audit axe dan referensi OpenAPI diperiksa.
- Lima skenario browser+chain terverifikasi: tiga skenario checkout sebelumnya, playground penuh sampai paid/signed receipt/reload, dan underpayment partial tanpa confirmed. Skenario partial diulang setelah perbaikan dropdown dan lulus. Semua pembayaran memakai mock token pada validator lokal.
- Alur playground penuh memakai tombol UI dari create invoice, membuka tab checkout QR, mengirim mock USDC, menunggu finalized, menerima webhook delivered/signature verified dan memuat ulang invoice. Tidak ada API key/control token pada request browser.
- Isolasi diuji: helper menolak environment non-localnet, target API eksternal, kredensial salah dan invoice tanpa prefix playground. Proxy menolak hostname publik. Satu action per invoice mencegah pengiriman kedua; action dengan hasil belum pasti tidak otomatis diulang.
- Migration 006/007 diterapkan tanpa reset volume; API/worker/validator tetap berjalan. local-tools baru hanya memiliki port internal Compose, tanpa binding port host. Web memakai proxy loopback dengan opt-in local/localnet.

Typecheck, lint, format dan build lulus. Pipeline CI memuat test browser fixture; eksekusi remote GitHub belum dilakukan. Fitur replay/fault controls pada UI, hosted sandbox/session isolation, provision Devnet, wallet nyata dan Safari/perangkat fisik tetap terbuka. Test runner menyuntikkan fixture hanya untuk UI test; produk tidak mempunyai route untuk memaksa status paid.

Penggunaan: [PLAYGROUND.md](PLAYGROUND.md). Kebutuhan Devnet: [DEVNET.md](DEVNET.md).
