# Transactions dan pagination riwayat invoice

Menu **Transactions** (`/dashboard/transactions`) menampilkan seluruh transfer
yang telah dicatat scanner finalized pada environment/cluster aktif. Satu
signature dapat berisi beberapa instruction transfer; setiap baris memakai ID
transfer tersendiri, bukan menganggap satu signature selalu satu pembayaran.
Data bersifat read-only dan tidak memicu pemindaian RPC dari browser.

Filter tersedia untuk project, USDT/USDC, klasifikasi transfer, signature lengkap
secara persis, dan transfer tanpa invoice. Filter project dan Tanpa invoice tidak
dapat dipakai bersamaan. Signature menerima base58 dengan batas panjang;
pencarian ini tidak memverifikasi atau membuat transaksi baru. Mint/destination,
slot, instruction dan waktu pencatatan tersedia pada Rincian transfer. Tautan
Explorer mengikuti cluster; invoice dan review ditautkan jika relevan.

Klasifikasi paid/partial/duplicate_payment dan lainnya adalah klasifikasi
transfer. Invoice terkait dapat sudah paid meskipun transfer baris tersebut
memerlukan review. Token yang tidak lagi memiliki konfigurasi/attempt historis
ditandai tidak tersedia; mint tetap ditampilkan. Transfer token/jaringan yang
tidak dipantau tidak otomatis masuk daftar.

## API admin dan scope

`GET /admin/transactions` memerlukan session dan `dashboard:read`. Query opsional:

- `project_id=<uuid>`, `asset=USDT|USDC`, `disposition=<klasifikasi>`.
- `signature=<signature lengkap>`, `unassigned=true`, `before=<id>`.

Respons berisi `items` maksimal 25 dan `next_cursor`. Urutan berdasarkan ID
pencatatan scanner menurun, bukan urutan waktu blok. Keyset menghindari duplikasi
ketika baris baru masuk; hasil bukan snapshot historis yang dibekukan. Semua
query dibatasi environment/cluster server, termasuk transfer tanpa invoice.
Role internal yang diizinkan dapat membaca seluruh project di scope tersebut;
filter project belum menjadi grant otorisasi per project.

## Riwayat detail invoice

`GET /admin/invoices/:id` menerima tiga cursor independen:

- `before_transfer=<id>`: `(block_time,id)` menurun.
- `before_event=<event UUID>`: `(created_at,event_id)` menurun.
- `before_delivery=<id>`: ID delivery menurun.

Masing-masing bagian mengembalikan maksimal 100 item dan cursor berikutnya pada
`next_cursors.transfers/events/deliveries`. `has_more` tetap tersedia untuk
kompatibilitas. Cursor harus berasal dari invoice yang sama; cursor foreign atau
tidak ditemukan ditolak `400 invalid_cursor`. Timestamp yang sama dipecahkan
menggunakan ID sehingga item tidak dilewatkan atau diulang. Timeline event
menampilkan urutan waktu naik di dalam halaman yang dipilih.

UI menyediakan **Riwayat berikutnya / Riwayat terbaru** pada setiap bagian;
memindahkan halaman satu bagian mempertahankan cursor bagian lain. Review dapat
dibuka langsung dari transfer non-paid. Navigasi tidak mengubah invoice, ledger,
event ataupun delivery.

Migration `012_transaction_history_indexes.sql` menambah index scope/histori untuk
query ini. Tidak ada perubahan matcher, scanner, wallet ataupun private key.

## Verifikasi

172 tes backend pada 24 file serta 15 tes browser dashboard/Transactions pada
desktop/mobile/narrow lulus. Integrasi memakai 105 transfer/event/delivery dengan
timestamp sama, memastikan cursor tidak mengulang atau melewatkan item, menolak
cursor invoice lain, membatasi environment/cluster, dan mempertahankan beberapa
instruction pada signature sama. Read-only dapat membaca, anonim ditolak, serta
invoice/ledger tidak berubah oleh pembacaan. Typecheck/lint/format/build lulus.

Migration 012 diterapkan di localnet/Devnet tanpa reset volume; API/web diperbarui,
worker tidak direstart. Readiness kedua API 200, Transactions anonim 401/no-store,
halaman anonim menuju login; dua invoice Devnet tetap paid. Screenshot
[desktop](qa/transactions-desktop-fixture.png) dan
[mobile](qa/transactions-mobile-fixture.png) memakai fixture, bukan data operator.
