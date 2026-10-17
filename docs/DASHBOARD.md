# Dashboard pembayaran — tahap baca

Buka `/dashboard` setelah login Entra. Implementasi memakai session admin dan
permission `dashboard:read` pada server API. Merchant API key tidak disisipkan
ke browser. Role admin, operator dan read-only yang berada dalam allowlist saat
ini dapat membaca seluruh project pada environment/cluster instance tersebut.
Filter project adalah pemilihan tampilan, **bukan grant otorisasi per project**.
Grant operator per project dan aksi manajemen masih mengikuti F7-02/F7-06.

## Yang tersedia

- Overview seluruh periode: total, paid, pending, confirming, expired dan invoice
  dengan transfer yang perlu review. Review dapat tumpang tindih dengan paid,
  misalnya pembayaran tambahan setelah lunas. Transfer tanpa invoice ditangani di Review queue.
- Penerimaan bruto USDT dan USDC dihitung dari `ledger_entries` bertipe payment,
  bukan jumlah seluruh transfer atau harga dasar invoice. Keduanya tetap terpisah;
  angka bukan saldo wallet, laba/net settlement atau konversi fiat.
- `/dashboard` khusus ringkasan dan penerimaan bruto dengan filter project.
  Tidak mengambil daftar invoice atau RPC wallet/scanner. Tautan Lihat invoice
  mempertahankan project yang dipilih.
- `/dashboard/invoices` khusus daftar; filter project/status/aset/order ID
  persis hanya memengaruhi daftar di halaman tersebut. Pagination 25 item, cursor created_at+id,
  halaman berikutnya dan kembali ke awal; bukan snapshot historis.
- Tabel desktop dan kartu mobile, waktu WIB, label Mock USDT khusus Devnet,
  empty/error states, refresh data eksplisit dan guard session expired/revoked.
- Detail invoice: project, nominal, version, mint/penerima, histori pilihan aset,
  transfer finalized beserta disposition/slot/instruction path, timeline event,
  dan delivery webhook. Link explorer mengikuti cluster. Tidak menyediakan tombol
  mark paid, refund atau replay.

Bagian transfer/event/delivery menampilkan maksimal 100 item terbaru dengan
penanda jika masih ada data. Daftar transfer global ada di `/dashboard/transactions`; pagination transfer/event/delivery detail tersedia secara terpisah. Timeline saat ini memuat pembuatan invoice dan event yang memang
sudah dipancarkan; tidak mengarang lifecycle event yang belum diimplementasikan.
Event confirmed tidak membuktikan delivery; Devnet tetap menampilkan belum ada
delivery selama webhook delivery dinonaktifkan.

## API admin internal

| Metode | Endpoint                         | Scope/perilaku                                                                        |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------- |
| GET    | `/admin/projects`                | Project pada environment aplikasi                                                     |
| GET    | `/admin/overview?project_id=...` | Counts dan gross ledger pada environment+cluster; project opsional                    |
| GET    | `/admin/invoices`                | Filter merchant list + project_id opsional; semua project internal jika tidak dipilih |
| GET    | `/admin/invoices/:id`            | Invoice, attempts, transfer, events, delivery dalam scope instance                    |

Semua endpoint memerlukan cookie session aktif, allowlist/tenant yang masih
berlaku dan dashboard:read. Bearer merchant saja tidak memberi akses. API memberi
no-store, 401 untuk session tidak sah, 403 untuk permission tidak cukup, 404 untuk
detail di luar scope dan 400 untuk filter/cursor tidak valid. Token/URL checkout,
API key, credential Entra dan secret webhook tidak dikembalikan.

Data diambil Next Server Components langsung dari API_INTERNAL_URL menggunakan
cookie request; tidak ada data proxy publik baru yang memberi akses bebas.
Pemeriksaan layout tidak menggantikan pemeriksaan session pada setiap API data.
Pembacaan overview/list/detail bersifat live dan dapat berubah antar request.
Tidak memerlukan migration atau reset data; session operator tetap berlaku.

## Bukti verifikasi dan batasnya

- 131 tes unit/integrasi pada 17 file lulus dengan PostgreSQL. Lima tes dashboard
  menggunakan schema terisolasi: role/session, scope environment/cluster/project,
  filter/cursor, gross hanya kredit ledger dan tidak ada bocoran checkout secret.
- Typecheck, lint file terkait, format dan build seluruh workspace lulus.
- Enam test browser fixture untuk desktop 1440, mobile 390 dan 320 px lulus:
  filter, pagination, empty state, detail/event/explorer, no horizontal overflow
  dan axe WCAG A/AA/2.1 AA. Screenshot berikut **fixture QA**, bukan data pembayaran
  nyata: [desktop](qa/dashboard-desktop-fixture.png),
  [mobile](qa/dashboard-mobile-fixture.png).
- Fixture API di `tests/fixtures/admin-dashboard-server.mjs` terpisah pada loopback
  14101 dan tidak diimpor aplikasi. Test opt-in `ADMIN_DASHBOARD_E2E=1` membutuhkan
  preview web yang API_INTERNAL_URL-nya menunjuk fixture itu; jangan menjalankannya
  terhadap API Devnet. Tidak ada session atau identitas uji yang ditambahkan ke
  database operator Devnet untuk pengujian browser ini.
- Snapshot DB Devnet sebelum rollout: dua invoice paid, dua kredit payment dan
  satu session admin aktif. Login Entra operator sudah terverifikasi pada tahap
  sebelumnya; pemeriksaan dashboard dengan cookie browser operator tetap dilakukan
  operator setelah refresh. MFA/logout nyata masih memiliki tugas terpisah.

Berikutnya: saldo wallet/checkpoint/lag (F7-07), daftar transfer global dan histori
berhalaman (F7-04), lifecycle webhook dan review queue, lalu manajemen project/key
beserta audit dan grant yang sesuai. Semua operasi tulis tetap memerlukan desain
permission, CSRF dan bukti transaksi masing-masing.

Rollout: API/web localnet dan Devnet sudah diperbarui, tanpa migration atau reset
volume. Smoke Devnet readiness 200; overview/list/projects anonim 401/no-store,
dashboard anonim redirect ke login, merchant list tetap menunjukkan dua invoice
paid. Session operator tidak dicabut. Preview fixture port 3101/14101 dihentikan
setelah QA; bukan service baru pada deployment.

## Dashboard profesional dan operasional wallet/scanner

Kerangka admin sekarang memiliki sidebar desktop, menu workspace mobile,
header jaringan/role, kartu metrik berikon, status invoice berwarna, panel filter,
kartu invoice mobile, dan detail pembayaran dengan hierarki yang sama.
Navigasi memakai halaman/anchor yang tersedia; tidak ada menu aksi dummy.
Tombol Perbarui data memakai router.refresh, mempertahankan filter dan
memuat ulang data server. Transaksi/ledger tidak diubah oleh penyegaran UI.

`GET /admin/operations` memakai guard session/permission yang sama dengan API
admin lainnya. Data seluruh environment dibaca dari konfigurasi token yang
terverifikasi (genesis, mint, decimals, owner, canonical ATA), saldo token
finalized RPC dan checkpoint DB. Saldo adalah wallet bersama seluruh project,
sehingga tidak mengikuti filter project pada overview. Angka tidak digabungkan
antar aset atau disamakan dengan kredit ledger. Alamat owner, ATA dan mint
tersedia dalam rincian setiap wallet; URL RPC/credential tidak dikirim ke UI.

Status checkpoint:

- Terpantau: monitoring aktif, checkpoint diketahui, umur <=120 detik dan lag <=300 slot.
- Tertinggal: umur checkpoint >120 detik atau lag >300 slot.
- Belum terverifikasi: checkpoint hilang, waktu tidak konsisten atau RPC head di belakang checkpoint.
- Monitoring nonaktif: CHAIN_MONITORING bukan true.

Lag memakai selisih slot, tidak dikonversi menjadi estimasi durasi blockchain.
Umur dihitung dari updated_at DB ketika snapshot dibuat. Ini bukan heartbeat
proses atau bukti bahwa tidak pernah ada gap historis. Endpoint snapshot memakai
cache maksimal 15 detik/satu request RPC bersama per instance API; autentikasi
selalu diperiksa sebelum membaca cache. Jika pembacaan/validasi gagal, endpoint
memberi 503 generik dan UI menampilkan belum dapat diverifikasi, bukan saldo nol.
Panel dimuat terpisah dengan Suspense agar kegagalan RPC tidak menghilangkan
ringkasan/list invoice. Tidak ada failover RPC atau notifikasi alert otomatis pada
tahap ini; rekonsiliasi, job gagal dan alert tetap tugas berikutnya.

Snapshot live Devnet terverifikasi: head 511975652, USDC dan Mock USDT masing-masing
1.000001, lag checkpoint 61/54 slot, umur 13/11 detik. Ini bukti pembacaan live,
bukan nilai tetap yang ditanamkan ke UI.

Verifikasi versi ini: 136 tes backend pada 18 file dan sembilan tes browser
fixture desktop/mobile/narrow lulus; typecheck/lint terkait/build lulus.
Screenshot fixture visual: [desktop](qa/dashboard-professional-desktop-fixture.png),
[mobile](qa/dashboard-professional-mobile-fixture.png),
[panel wallet](qa/dashboard-wallet-desktop-fixture.png).
Fungsi baru diuji untuk cluster/decimals salah, RPC gagal tanpa zero fallback,
checkpoint hilang/stale/future, role/session, filter/pagination, navigasi menu,
refresh, axe dan overflow. Screenshot QA tidak membuktikan status Entra/MFA baru.

Rollout versi profesional+operasional: API/web Devnet dan localnet diperbarui.
Smoke Devnet readiness 200, operations anonim 401/no-store, dan dashboard anonim
redirect ke login. ReadOperations dari container API memverifikasi saldo dua aset
1.000001 dengan checkpoint current dalam 2.517 ms. Tidak ada migration atau
perubahan invoice/ledger/session operator. Preview fixture hanya untuk QA.

## Overview dan Wallet & scanner dipisahkan

Overview `/dashboard` memuat ringkasan invoice, penerimaan bruto ledger dan daftar
invoice. Panel saldo/checkpoint dipindahkan ke `/dashboard/wallet`, melalui menu
**Wallet & scanner** dengan penanda navigasi aktif. Halaman wallet memiliki tombol
refresh sendiri dan tetap memakai API operasi terautentikasi serta snapshot
finalized yang sama. Overview tidak lagi menjalankan permintaan data operasi RPC.
Filter project pada Overview tidak membatasi saldo wallet bersama.
