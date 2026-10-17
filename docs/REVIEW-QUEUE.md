# Review queue transaksi

Buka **Dashboard → Review queue**. Daftar berasal dari transfer yang sudah
tercatat scanner finalized pada environment/cluster aktif dan memiliki
`disposition <> paid`, termasuk transfer tanpa invoice. Tersedia filter jenis
masalah, status penanganan, project dan aset serta cursor 25 transfer per halaman.
Filter project mengecualikan transfer tanpa invoice; gunakan Semua project untuk
melihat transfer tersebut. Token tidak tersedia jika konfigurasi mint/ATA tidak
lagi ditemukan; UI tetap menampilkan mint dan akun tujuan pada bukti.

## Penanganan operator

1. Buka transfer; periksa mint, akun token tujuan, nominal, slot, instruction,
   signature, waktu dan invoice terkait. Explorer mengikuti cluster aktif.
2. Pilih **Sedang ditinjau**, **Review ditutup** atau **Belum ditangani** untuk
   membuka kembali pekerjaan. Catat alasan dan bukti penanganan 10–2.000 karakter.
3. Tinjau konfirmasi lalu simpan. Riwayat menyimpan operator, waktu, status asal
   dan tujuan serta versi. Catatan lama tidak diedit/dihapus dari dashboard.

Status penanganan terpisah dari status pembayaran. Menutup review tidak memberi
kredit ledger, mengubah invoice menjadi paid, memindahkan dana, mengirim event
baru atau membuktikan refund. Transfer baru tetap menjadi item review baru;
pembayaran duplikat tidak disatukan dengan review lama. Jangan menyimpan secret
atau data pribadi pembeli pada catatan.

Queue mencakup unmatched, partial, overpaid, late, duplicate_payment,
ambiguous_reference, reference_conflict, inactive_attempt dan predates_invoice.
Nominal kurang/lebih bayar tanpa reference yang cocok dapat tetap diklasifikasikan
unmatched oleh matcher; dashboard tidak menebak kepemilikan transfer. Token salah
yang tidak dimonitor scanner tidak otomatis muncul. Penautan manual transfer,
re-settlement dan eksekusi/verifikasi refund belum tersedia.

## Akses dan konsistensi

Semua role internal yang diizinkan dapat membaca queue sesuai environment dan
cluster. Admin/operator dengan `review:write` dapat menulis setelah pemeriksaan
Origin, CSRF dan fresh auth Microsoft maksimal 10 menit. Belum ada grant per
project; filter project bukan batas otorisasi tersendiri.

Write mengunci transfer, memeriksa `expected_version`, lalu menyimpan state,
catatan append-only dan audit identitas dalam satu transaksi. UUID
`Idempotency-Key` yang sama dengan payload yang sama mengembalikan hasil lama.
Payload lain pada UUID tersebut ditolak. Perubahan operator lain mengembalikan
`409 review_changed`; muat ulang bukti dan riwayat sebelum mencoba lagi. Saat
respons jaringan hilang, coba permintaan yang sama atau periksa riwayat terlebih
dahulu; jangan mengasumsikan penyimpanan gagal.

Route admin menggunakan session cookie:

- `GET /admin/reviews?status=active&disposition=partial&project_id=<uuid>&asset=USDC&before=<id>`.
  `active` mencakup open/in_progress; `all` mencakup seluruh status.
- `GET /admin/reviews/:id?before_note=<id>`: bukti serta 25 catatan dengan cursor.
- `POST /admin/reviews/:id`: body
  `{ "status": "in_progress", "expected_version": 0, "reason": "Hasil pemeriksaan transfer..." }`.

Migration `010_transfer_reviews.sql` menambah tabel review/catatan dan index queue.
API readiness dengan admin aktif mensyaratkan migration ini. Deploy migration
sebelum API baru. Tidak ada perubahan pada scanner, matcher atau worker delivery.

## Verifikasi

Tes integrasi PostgreSQL memakai schema terisolasi: role/Origin/CSRF/fresh auth,
filter/scope, unmatched tanpa project, paid/cluster lain ditolak, concurrent retry,
konflik versi, close/reopen, cursor transfer/catatan, audit, dan invoice/ledger/event
tetap tidak berubah. Tes browser memakai fixture terpisah untuk navigasi API keys,
filter/pagination review, bukti Explorer, read-only, alasan/konfirmasi operator,
login ulang, konflik versi, aksesibilitas dan overflow desktop/mobile/narrow.
Pengujian tidak menulis review pada DB Devnet milik operator.

Hasil: 154 tes backend (21 file) dan 39 browser admin pada tiga viewport lulus.
Typecheck/lint/format/build lulus. Migration 010 dan API/web tersedia pada Docker
localnet/Devnet. Screenshot [desktop](qa/admin-reviews-desktop-fixture.png) dan
[mobile](qa/admin-reviews-mobile-fixture.png) memakai fixture, bukan data operator.
Dua invoice Devnet tetap paid; tabel review/catatan Devnet belum berisi mutasi uji.
