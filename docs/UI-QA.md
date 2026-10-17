# QA refonte UI — Zekivo Pay

Pemeriksaan Chromium pada desktop 1440×1000, mobile 390×844 dan narrow 320×740. Perubahan meliputi homepage, navigasi/panduan dokumentasi, Scalar API reference, playground, checkout dan tampilan alat operator Devnet.

## Hasil verifikasi

- 100 test unit/integrasi PostgreSQL lulus, termasuk CORS yang mengizinkan origin docs terkonfigurasi dan tetap menolak origin lain tanpa melewati autentikasi.
- Typecheck, lint, format dan build production lulus.
- **48 test browser lulus dalam satu run pada image Docker akhir** (2,2 menit), meliputi homepage/panduan, Scalar, playground dan checkout pada ketiga viewport. QA menemukan blok kode panduan narrow yang tidak dapat difokuskan saat scroll; tabindex diperbaiki sebelum run akhir. Enam test visual/keyboard/axe checkout dan playground sebelumnya juga diulang dan lulus.
- Lima test browser + chain pada Docker localnet lulus dalam satu run: USDT reference, USDC manual, pergantian aset dengan pembayaran pilihan lama + pembayaran kedua, seluruh alur playground hingga signed webhook dan reload, serta kurang bayar tanpa webhook confirmed. Dana semuanya token mock localnet.
- Scalar membaca OpenAPI gateway melalui endpoint frontend yang terpisah dari helper. Test Request GET /health benar-benar dikirim dari modal Scalar ke API port 4100 dan menerima HTTP 200/local/localnet. Tidak ada request eksternal pada pemeriksaan tersebut. Key merchant tidak dimasukkan untuk health.
- Ditemukan dan diperbaiki perbedaan hostname NextRequest dalam Docker: derivasi server publik localnet memakai Host loopback tervalidasi, sehingga tidak menampilkan hostname bind/container kepada browser.
- Alat operator port 4400 membaca ATA Devnet yang sudah finalized, menampilkan status siap dan penjelasan tidak ada transfer USDC. Mobile tidak overflow. Tidak mengirim atau menandatangani transaksi Devnet baru pada refonte UI.

Kontras menu aktif diperbaiki. Logo memiliki nama aksesibel baru `zekivo pay`, dan test fokus keyboard menyesuaikan nama tersebut. Pemeriksaan axe pada permukaan homepage, panduan, playground dan checkout tidak menemukan pelanggaran A/AA yang diperiksa setelah perbaikan. Scalar diverifikasi pada pemuatan kontrak/navigasi/overflow, bukan diklaim telah melalui audit aksesibilitas vendor menyeluruh.

## Screenshot

Screenshot checkout dan playground memakai fixture UI agar visual deterministik; UUID/signature demo bukan bukti transaksi. Bukti chain berasal dari lima skenario terpisah di atas. Indikator Next development dapat muncul pada capture lokal.

| Permukaan                  | Desktop                                          | Mobile                                                     |
| -------------------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| Homepage                   | [Screenshot](qa/redesign-home-desktop.png)       | [Screenshot](qa/redesign-home-mobile.png)                  |
| Checkout                   | [Screenshot](qa/redesign-checkout-desktop.png)   | [Screenshot](qa/redesign-checkout-mobile.png)              |
| Playground                 | [Screenshot](qa/redesign-playground-desktop.png) | [Screenshot](qa/redesign-playground-mobile.png)            |
| Scalar/API aktual          | [Screenshot](qa/redesign-api-desktop.png)        | Pengujian overflow dan kontrak tersedia pada suite browser |
| Operator/ATA Devnet aktual | —                                                | [Screenshot](qa/redesign-operator-mobile.png)              |

## Batas pengujian

Safari, wallet mobile/perangkat fisik, payment link Devnet dan invoice/webhook Devnet belum diuji melalui refonte ini. Keberhasilan setup ATA tidak berarti gateway Devnet sudah diprovision. Dashboard operasional belum dibangun; landing/developer overview tidak menampilkan data finansial palsu sebagai dashboard. Mainnet/production tetap tidak diaktifkan.

Detail komponen dan sumber: [UI-DESIGN.md](UI-DESIGN.md). Pekerjaan lanjutan tetap mengikuti [ROADMAP.md](ROADMAP.md), dengan provision Devnet sesudah milestone UI.

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

Verifikasi refund: suite penuh 209 tes backend pada 28 file lulus; tambahan
kasus konkurensi UUID lintas invoice juga lulus dalam 8 tes API refund terisolasi.
Sembilan tes browser refund lulus pada desktop/mobile/320 px; 27 tes dashboard/
project yang terdampak juga lulus. Typecheck/lint/format dan build web lulus.
Bukti screenshot adalah fixture, bukan refund Devnet nyata:
[desktop](qa/refund-desktop-fixture.png), [mobile](qa/refund-mobile-fixture.png).
