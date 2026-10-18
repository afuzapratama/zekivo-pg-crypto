# Bukti QA checkout — 17 Oktober 2026

Checkout sandbox diperiksa langsung memakai Chromium Headless Shell 156.0.8078.4, Playwright 1.64.1 pada Linux. Screenshot dibuka dan diperiksa secara visual pada tiga viewport. Ini emulasi browser, bukan bukti kompatibilitas perangkat fisik atau aplikasi wallet.

| Pemeriksaan                                          | Hasil                                                                                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Desktop 1440×1000                                    | Lulus; dua kolom, nominal/alamat/mint terbaca, fokus keyboard terlihat                                                                                       |
| Mobile 390×844                                       | Lulus; satu kolom, rincian dapat dilipat, QR lebih cepat terlihat                                                                                            |
| Layar sempit 320×740                                 | Lulus; tidak ada horizontal overflow saat mint panjang dibuka                                                                                                |
| Audit otomatis axe WCAG 2 A/AA + 2.1 AA pada pending | Tidak ada pelanggaran terdeteksi di ketiga viewport; bukan sertifikasi aksesibilitas penuh                                                                   |
| Target sentuh copy                                   | Minimal tinggi 44 px; nama aksesibel sesuai teks tombol                                                                                                      |
| QR                                                   | Pixel QR berhasil didecode, identik dengan URI link wallet; recipient, amount, mint dan reference cocok                                                      |
| Clipboard                                            | Jalur berhasil dan permission gagal teruji; teks tetap dapat disalin manual                                                                                  |
| Koneksi                                              | Network failure/backoff, browser offline/online dan reload paid teruji; instruksi kirim tidak muncul saat offline                                            |
| Batas waktu                                          | Countdown berhenti mengizinkan kirim saat nol; status server tetap dipoll untuk transfer tepat waktu yang baru diindeks                                      |
| Jam perangkat                                        | Mengubah Date.now tidak memperpanjang invoice; countdown memakai timer monoton                                                                               |
| Kondisi lain                                         | Review partial, confirming, disabled, invalid link, server error, wallet fallback dan kegagalan canvas QR teruji                                             |
| Privasi browser                                      | Request status memakai header token, tidak membawa merchant Authorization atau referrer                                                                      |
| Localnet end-to-end                                  | USDT reference dan USDC manual: invoice → browser → transaksi mock finalized → paid → webhook signature verified → fulfillment satu kali → reload tetap paid |

Suite fixture UI: **30 test lulus**. Suite browser+chain: **2 test lulus**. Unit/integrasi PostgreSQL: **76 test lulus**. Typecheck, lint dan build lulus. Test chain menggunakan layanan Docker lokal yang sudah berjalan; tidak mereset database atau ledger. Suite fixture browser juga ditambahkan ke pipeline CI; eksekusi remote GitHub belum dilakukan.

Temuan yang diperbaiki: label HTML mengubah nama aksesibel tombol copy; target sentuh terlalu kecil; kontras caption/footer kurang; QR mobile terlalu jauh di bawah; countdown sebelumnya bergantung jam perangkat. Status koneksi, stale request, kegagalan QR, petunjuk wallet dan log URL checkout diperkuat bersamaan dengan pengujian.

Screenshot menggunakan **data fixture sintetis**; bukan contoh pembayaran nyata: [desktop](qa/checkout-desktop.png), [mobile](qa/checkout-mobile.png), [320 px](qa/checkout-narrow.png). Screenshot dari development memuat indikator developer Next dan fokus keyboard yang sengaja diperiksa.

Belum selesai: aplikasi wallet nyata pada Devnet, Safari/iOS/WebKit, perangkat fisik, pergantian aset dengan attempt history (F2-07), redaksi token pada ingress/APM deployment, serta return URL allowlist bila redirect ditambahkan. Scanner finalized-only; confirming dalam suite UI merupakan fixture, bukan observasi chain yang sudah diimplementasikan.

Perintah pengujian dan prasyarat: [CHECKOUT.md](CHECKOUT.md). Test suite adalah [checkout.spec.ts](../tests/browser/checkout.spec.ts) dan [checkout-chain.spec.ts](../tests/browser/checkout-chain.spec.ts).

## Verifikasi pemasangan Docker

Web Compose port 3100 sudah menggunakan image UI terbaru. Enam smoke browser lulus pada ketiga viewport untuk layout/keyboard/axe serta decode QR. Temuan khusus Docker: Next development memblokir origin 127.0.0.1 dan menahan hydration pada layar memuat. Perbaikan memakai allowedDevOrigins tambahan hanya untuk loopback 127.0.0.1 dan IPv6 loopback; setelah rebuild/recreate web, test lulus. API/worker/validator/database tidak direset. Typecheck, lint dan build diulang sesudah perubahan konfigurasi dan lulus.

## Pemilihan aset dan attempt/history

Hasil terbaru: **85 test unit/integrasi**, **39 test UI fixture** pada tiga viewport, serta **3 test browser+chain Docker** lulus. Suite UI menambahkan perubahan QR sesuai quote merchant, stale-version conflict yang memuat status terbaru, serta penolakan request lintas origin/harga buatan/body terlalu besar. Suite chain menambahkan pergantian USDT ke quote USDC dengan harga berbeda, pembayaran memakai reference USDT lama, lalu transfer kedua USDC manual. Invoice tetap paid dengan aset sebenarnya; hanya satu event/receipt signed dan fulfillment.

Race antar-tab serta pembayaran dua aset serentak juga diuji terhadap PostgreSQL, termasuk reservasi historis dan pilihan yang belum diaktifkan. Kompatibilitas aplikasi wallet/Safari/perangkat fisik masih terbuka; simulasi browser tidak menggantikan pengujian tersebut. Kontrak: [PAYMENT-ATTEMPTS.md](PAYMENT-ATTEMPTS.md).

### Devnet Mock USDT — 17 Oktober 2026

Invoice nyata Devnet `82beb8c4-42e6-476c-a60e-a0aa3ad8d4a1` sudah dibuat,
masih pending sebelum transfer pembeli. Checkout menampilkan label Mock USDT,
peringatan token uji bukan Tether, nominal 1.000001, dan mint proyek yang benar
pada bagian “Periksa mint token”. Pemeriksaan Chromium 390×844 dan 1440×1000:
tidak ada overflow horizontal atau pelanggaran axe WCAG A/AA/2.1 AA.
Tiga pengujian halaman status Devnet (desktop/mobile/narrow) lolos dengan gateway
ready, local signer dinonaktifkan dan guard Host aktif. Typecheck dan lint lolos.
Pengujian inti/database 112 tes lolos; penambahan assertion pin USDT juga lolos.
Status paid USDT belum diuji sampai pembeli menandatangani transfer.

### Tema hitam netral — 18 Oktober 2026

Layout pelanggan mengikuti referensi operator: ringkasan di kiri dan panel
pembayaran di kanan, nominal/alamat berdampingan dengan QR pada desktop. Mobile
memakai satu kolom. Palet zinc netral berlaku khusus checkout; disclosure menampung
rincian invoice dan mint. Penanda token uji tetap terlihat. Nominal tetap tampil
pada paid/review/expired; QR dan aksi kirim mengikuti guard server yang sama.

Seluruh 39 tes `checkout.spec.ts` lulus pada desktop, mobile dan 320 px: WCAG/axe,
keyboard, no overflow, decode URI QR, clipboard, reconnect, expiry, review, paid,
pergantian aset/konflik dan validasi proxy. Urutan keyboard diperbarui mengikuti
layout: rincian → salin nominal → salin alamat → wallet. ESLint/TypeScript lulus.
Screenshot menggunakan fixture sintetis:
[desktop](qa/checkout-neutral-desktop-fixture.png),
[mobile](qa/checkout-neutral-mobile-fixture.png).

Alur localnet setelah redesign juga lulus: membuat invoice lewat playground,
membuka checkout, membayar mock token, melihat finalized/paid, menerima webhook
signature verified, lalu reload mempertahankan status. Tidak ada transaksi Devnet
atau perubahan staging pada pengujian ini.
