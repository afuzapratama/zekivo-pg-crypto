# Monitoring dan rekonsiliasi

Menu **Monitoring** (`/dashboard/monitoring`) menampilkan heartbeat monitor,
status API/scanner/rekonsiliasi, jadwal berikutnya, riwayat pemeriksaan dan contoh
temuan. Semua pembacaan memakai session admin internal, `dashboard:read` dan
scope environment/cluster server. Tidak ada credential RPC/SMTP/private key pada
respons. Filter histori bukan grant per project; akses internal masih mencakup
seluruh project di environment tersebut.

## Proses terpisah

Compose menyediakan service `monitor`, terpisah dari `worker`. Dua loop monitor
berjalan bersamaan: uptime serta rekonsiliasi. RPC lambat pada rekonsiliasi tidak
menghalangi loop uptime. Monitor memeriksa `/health` API (termasuk identitas
service/environment/cluster) dan heartbeat scanner yang tersimpan. Tidak memakai
endpoint `/ready` untuk polling rutin karena readiness memverifikasi konfigurasi
chain dan menambah panggilan RPC.

Polling normal berjeda 30 detik setelah iterasi. Kegagalan API/scanner perlu tiga
pemeriksaan berturut-turut sebelum alert; heartbeat scanner dianggap lama setelah
120 detik. Status monitor sendiri menjadi belum terverifikasi pada dashboard jika
heartbeat melebihi 120 detik. Status rekonsiliasi mendapat grace 30 menit karena
jadwal dan waktu akses RPC. Scanner yang dinonaktifkan ditampilkan nonaktif.

Incident alert dideduplikasi di DB, pengingat maksimal satu per jam per komponen,
dan pemulihan menghasilkan notifikasi. Monitor dapat mendispatch antrean SMTP/
Telegram yang sama, sehingga alert tetap bisa dikirim ketika worker utama mati.
Claim/lease notifikasi mencegah dua proses mengirim claim yang sama sekaligus;
jaminan transport tetap at least once sebagaimana [NOTIFICATIONS.md](NOTIFICATIONS.md).

Monitor lokal **berbagi host dan database** dengan gateway. Kegagalan seluruh
host/DB, Docker daemon, jaringan host atau matinya monitor sendiri tidak dapat
dijamin dilaporkan oleh proses ini. Jika DB tidak tersedia, monitor tidak dapat
membaca kanal, menyimpan hasil atau mengklaim notifikasi. Pemantauan dari luar
host (tahap Azure) tetap wajib sebelum produksi. Ini belum merupakan independent
provider uptime check yang sudah dipasang di Azure.

## Pemeriksaan database

Setiap run mengambil snapshot `REPEATABLE READ READ ONLY` untuk seluruh invoice
pada scope aktif. Pemeriksaan mencakup:

- Invoice paid memiliki kredit payment; kredit konsisten dengan nominal/aset
  invoice, transfer, scope, disposition paid dan attempt aktif/waktu pembayaran.
- Transfer paid merujuk invoice paid dalam scope yang sesuai dan kredit ledger
  yang cocok.
- Invoice paid memiliki event payment.confirmed; identitas event/project/invoice,
  cluster, mint, aset, nominal diterima, finality serta signature/path/slot pada
  event sesuai catatan pembayaran.

Jumlah temuan dihitung untuk seluruh hasil; maksimal 100 contoh database disimpan
per run. Tambahan temuan pemeriksaan chain dapat disimpan untuk batch tersebut.
Dashboard menampilkan maksimal 100 contoh dan menandai jika masih ada temuan lain.
Rekonsiliasi tidak mengubah invoice/ledger/transfer/outbox, melakukan settlement,
mengirim dana atau mengeksekusi refund. Investigasi dilakukan operator.

## Verifikasi ulang bukti chain

Run memakai konfigurasi token/owner/canonical ATA dan genesis yang divalidasi
melalui validator bersama scanner. Maksimal **10 transfer berdisposition paid**
dibaca ulang per run menggunakan `getTransaction` jsonParsed pada commitment
finalized. Decoder yang sama memeriksa instruction path, destination, mint,
owner metadata, decimals, amount, slot dan waktu blok terhadap catatan.

Cursor persisten berdasarkan ID transfer berjalan ke depan. Setelah akhir
histori, cursor kembali nol untuk putaran berikutnya. Jika provider tidak bisa
mengembalikan transaksi (termasuk kemungkinan histori pruned), RPC error atau
konfigurasi tidak dapat diverifikasi, status chain menjadi tidak lengkap dan
cursor ditahan untuk retry. Tidak mengartikan transaksi null sebagai pencurian
atau hasil bersih. Mismatch bukti yang dapat dibaca dicatat sebagai temuan.

`clean` berlaku untuk **snapshot database dan batch yang tercantum**, bukan bukti
bahwa semua histori chain baru saja diverifikasi dalam satu snapshot. Ini belum
memindai ulang seluruh incoming/outgoing wallet untuk mendeteksi transfer yang
sama sekali belum dicatat scanner, dan belum merekonsiliasi saldo treasury.
Saldo finalized tidak disamakan dengan penerimaan bruto ledger: direct deposit,
transfer lain, pemindahan dana dan rent token account dapat memerlukan baseline
serta klasifikasi sendiri. Coverage penuh tersebut tetap gate roadmap.

## Jadwal, lease dan hasil

Run pertama mulai ketika monitor aktif. Setelah selesai, run berikutnya dijadwalkan
15 menit kemudian; loop memeriksa jadwal setiap sekitar 30 detik. Lease 10 menit
diperoleh atomik per environment/cluster. Setelah proses crash/lease habis, run
lama ditandai abandoned saat pengganti mengklaim pekerjaan. Token lease lama tidak
boleh menulis hasil setelah pekerjaan digantikan. Shutdown keras dapat meninggalkan
run running sampai lease berakhir; tidak mengubah status pembayaran.

Status run: `running`, `clean`, `findings`, `unavailable`, `failed`, `abandoned`.
Pemeriksaan database gagal tidak menghasilkan clean. Hasil, temuan, cursor,
status operasional dan notifikasi perubahan incident dicatat sebelum transaksi
hasil di-commit. Kegagalan DB total memerlukan retry setelah DB pulih.

API read-only: `GET /admin/monitoring?run_id=<id>&before_run=<id>`; riwayat 25 run
per halaman, scope selalu dipatok server. Run scope lain tidak dapat dipilih.

## Menjalankan dan deployment

```sh
# Native: konfigurasi database/RPC dan scope seperti gateway.
MONITOR_API_URL=http://127.0.0.1:4100 pnpm exec tsx packages/monitoring/src/main.ts

# Service terpisah pada masing-masing Compose.
docker compose up -d --no-deps monitor
docker compose --env-file .env.devnet -f compose.devnet.yaml up -d --no-deps monitor
```

Migration `013_monitoring.sql` harus diterapkan sebelum API/monitor baru.
Monitor menerima DATABASE_URL, scope, SOLANA_RPC_URL, aset aktif, flag monitoring,
NOTIFICATION_ENCRYPTION_KEY dan flag Mailpit lokal; tidak menerima credential
Entra atau private key treasury. `WEBHOOK_DELIVERY=false` Devnet tetap berlaku.
Notifikasi hanya terkirim jika kanal dikonfigurasi/aktif. Restart monitor tidak
mereset cursor atau jadwal yang sudah tersimpan.

## Bukti implementasi

187 tes backend pada 26 file lulus. Pengujian mencakup snapshot settlement aktual,
ledger/event rusak tanpa auto-repair, RPC null/error, chain mismatch, lease
bersamaan/pengganti, crash recovery, sample limit, histori/cursor/scope, threshold,
cooldown, recovery serta dispatch alert saat heartbeat worker tetap stale.
18 tes browser dashboard/monitoring pada desktop/mobile/narrow lulus; stale monitor
tidak menampilkan klaim healthy dan RPC unavailable tidak menampilkan chain lengkap.
Typecheck/lint/format/build web serta bundle entrypoint monitor lulus.
Screenshot [desktop](qa/monitoring-desktop-fixture.png) dan
[mobile](qa/monitoring-mobile-fixture.png) memakai fixture terisolasi.

Migration 013 serta API/web/monitor telah diterapkan pada localnet dan Devnet tanpa
reset database atau restart worker utama. Run Devnet pertama: 2 invoice, 2/2
transfer paid diperiksa ulang melalui RPC finalized, nol temuan, akhir putaran
tercapai. API/scanner/rekonsiliasi melaporkan healthy; readiness 200, API monitoring
anonim 401/no-store dan kedua invoice tetap paid. Monitor tidak menerima secret
Entra dan tidak mengaktifkan webhook merchant Devnet.

Run localnet pertama memiliki 36 invoice dengan pemeriksaan database tanpa
inkonsistensi, tetapi 10 bukti transfer batch tidak tersedia dari RPC. Histori
RPC lokal mulai slot 72.223 sementara transfer paid tersimpan berada pada slot
282–23.719; hasil sengaja `unavailable`, bukan `clean`. Cursor ditahan dan tidak
ada reset/reclassification data agar pemeriksaan terlihat lulus. Untuk histori
terpangkas diperlukan sumber RPC/arsip yang menyediakan bukti tersebut; coverage
batch berikutnya dapat tertahan sampai sumber bukti tersedia. Ini bagian dari
gate histori/archival sebelum produksi, bukan alasan mengabaikan bukti yang hilang.
