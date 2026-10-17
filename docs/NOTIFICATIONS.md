# Notifikasi admin: SMTP dan Telegram

Buka **Dashboard → Notifikasi**. Kanal bersifat internal per environment/cluster,
untuk pembayaran confirmed, transfer non-paid yang perlu review, webhook dead,
scanner gagal/stalled dan pulih. Ini bukan webhook merchant atau bukti bayar
pembeli. Invoice belum menyimpan email pembeli; customer receipt dijadwalkan
terpisah di roadmap.

## Menguji dengan Mailpit yang sudah berjalan

Mailpit existing tersedia di SMTP host port 1025 dan inbox
[http://localhost:8025](http://localhost:8025). Service Mailpit proyek lain tidak
dimodifikasi atau dimatikan, dan inbox tidak dikosongkan oleh pengujian.

1. Login admin, buka Notifikasi; login ulang Microsoft bila diminta.
2. Pada Email SMTP pilih **Mailpit lokal · port 1025**.
3. SMTP host `host.docker.internal` untuk worker Docker, port otomatis 1025.
   Native development memakai `127.0.0.1` atau `localhost`.
4. Isi Email pengirim `pg-notifications@example.test` dan Email admin penerima
   `admin-notifications@example.test`, lalu aktifkan kanal dan simpan.
5. Klik **Uji kanal → Ya, antrekan pesan uji**. Periksa log dan inbox Mailpit.

Mode Mailpit tidak memakai password atau TLS. Host dibatasi pada tiga nama di
atas dan port tepat 1025. Mode ini diizinkan local/localnet; staging/devnet lokal
memerlukan opt-in `LOCAL_MAILPIT_ENABLED=true` pada API dan worker. Flag tersebut
diaktifkan pada `.env.devnet` workspace ini sesuai permintaan pengujian. Compose
menambah alias host gateway pada worker. Mainnet/production tetap dinonaktifkan
oleh konfigurasi gateway.

Smoke terisolasi membuat schema sementara, mengantrekan email, menjalankan
transport SMTP sungguhan lalu mencari hanya pesan milik smoke di Mailpit API:

```sh
TEST_DATABASE_URL=postgres://gateway:localdev@localhost:55432/gateway_test pnpm local:notification-smoke
```

Dari worker Docker lokal (DATABASE_URL mengikuti container, schema tetap terisolasi):

```sh
docker compose exec -e MAILPIT_SMTP_HOST=host.docker.internal -e MAILPIT_API_URL=http://host.docker.internal:8025 worker pnpm local:notification-smoke
```

Schema dibuang setelah smoke; pesan uji tetap di inbox agar dapat dilihat.
Tidak ada invoice atau konfigurasi kanal environment aktif yang diubah oleh smoke.

## SMTP publik dan Telegram

SMTP publik memakai mode SMTP, host DNS/IP publik, port 587 dengan STARTTLS wajib
atau 465 TLS langsung, username/password serta satu alamat from/to. Sertifikat
TLS diverifikasi dan IP DNS yang diperiksa dipakai untuk koneksi. Tidak ada opsi
menonaktifkan verifikasi sertifikat. Password kosong pada pembaruan berarti
pertahankan password lama; mengganti host atau username memerlukan password baru.
Tidak ada attachment/file/URL konten eksternal.

Telegram memakai bot token dari BotFather dan chat ID numerik admin/group privat.
Mulai percakapan dengan bot atau tambahkan bot ke group yang dituju terlebih
dahulu. Simpan lalu gunakan pesan uji eksplisit. Transport hanya mengakses
`api.telegram.org`, memakai teks biasa tanpa parse markup, dan menghormati
`retry_after` saat rate limited. Token dan error provider mentah tidak disimpan
ke log. Telegram nyata menunggu bot token/chat ID milik operator; pengujian unit
menggunakan respons simulasi dan tidak menghubungi chat eksternal.

## Antrean dan status

- `waiting_configuration`: kanal belum tersimpan, nonaktif, atau encryption key
  worker belum tersedia. Tidak menghabiskan attempt.
- `pending`: siap dikirim/retry pada jadwal berikutnya.
- `inflight`: diklaim worker dengan lease 90 detik, satu attempt per claim.
- `sent`: SMTP menerima recipient/message atau Telegram mengembalikan `ok=true`.
  Ini bukan bukti email tiba di inbox/dibaca atau bukti transaksi dibayar.
- `dead`: gagal setelah 10 percobaan. Perbaiki kanal lalu gunakan pesan uji baru;
  replay notifikasi dead belum tersedia di UI.
- `expired`: batas usia 24 jam berakhir, termasuk ketika menunggu konfigurasi.
  Event tetap tercatat; pengaktifan kanal tidak mengirim backlog kedaluwarsa.

Retry memakai exponential backoff 30 detik sampai 1 jam, dengan batas usia di
atas. Queue/deduplikasi/lease bertahan saat restart. Pengiriman bersifat at least
once: provider mungkin menerima pesan sebelum timeout/crash sehingga retry dapat
menduplikasi pesan. Email memakai Message-ID stabil per event sebagai petunjuk
deduplikasi; ini bukan jaminan provider melakukan deduplikasi.

Collector dimulai dengan cutoff persisten saat worker notifikasi pertama aktif;
dua pembayaran Devnet lama tidak dikirim ulang sebagai pesan baru. Event baru
bersumber dari outbox confirmed, transfer dan status delivery webhook yang sudah
tersimpan, tanpa mengubah settlement. Maksimum 100 sumber dikoleksi per iterasi.
Failure scanner dideduplikasi per jam; recovery dicatat setelah failure.
Heartbeat scanner lebih dari 120 detik tanpa pembaruan dapat memicu stalled jika
loop notifikasi masih hidup. Jika seluruh worker/DB mati, alert internal tidak
bisa diandalkan: uptime monitor eksternal dan rekonsiliasi terjadwal masih tugas
roadmap tersendiri. Channel failure tidak menghentikan scanner/settlement.

## Keamanan dan deployment

`NOTIFICATION_ENCRYPTION_KEY` berisi 32 byte acak dalam 64 karakter hex; API dan
worker harus memakai key yang sama. Key tidak diteruskan ke web/Entra. Konfigurasi
SMTP dan bot token disimpan AES-256-GCM, tidak dikembalikan melalui GET. Jangan
mengganti key tanpa prosedur re-encryption dan backup; hilangnya key membuat
secret tersimpan tidak dapat dibaca.

Role admin dengan `notification:manage`, Origin, CSRF, fresh auth 10 menit dan
UUID Idempotency-Key diperlukan untuk save/test. Versi konfigurasi mencegah
operator menimpa perubahan lain; retry request sama tidak menggandakan test atau
save. Audit atomik mencatat identitas/action/channel tanpa plaintext secret.
Read-only/operator internal dapat membaca metadata/log di environment aktif;
belum ada grant per project. Save mengubah konfigurasi untuk claim berikutnya;
pengiriman yang sudah inflight dapat memakai snapshot konfigurasi sebelumnya.

Migration `011_notifications.sql` harus diterapkan sebelum API/worker baru.
Worker tetap tidak menerima credential Entra atau private key treasury.
`WEBHOOK_DELIVERY=false` Devnet tetap dipertahankan; notifikasi tidak mengaktifkan
pengiriman webhook merchant. Konfigurasi kanal nyata diisi operator lewat admin,
bukan dibuat diam-diam oleh smoke.

Referensi: [Nodemailer SMTP](https://nodemailer.com/smtp),
[Telegram Bot API](https://core.telegram.org/bots/api#sendmessage),
[Mailpit SMTP](https://mailpit.axllent.org/docs/configuration/smtp/),
[Mailpit API](https://mailpit.axllent.org/docs/api-v1/).

## Bukti tahap implementasi

168 tes backend pada 23 file lulus. Regresi admin memeriksa 48 kasus browser pada
desktop/mobile/narrow; setelah memperbaiki race refresh form, 24 kasus pada area
notifikasi/API keys diulang dan lulus. Typecheck, lint, format serta build lulus.
Screenshot [desktop](qa/admin-notifications-desktop-fixture.png) dan
[mobile](qa/admin-notifications-mobile-fixture.png) memakai fixture terisolasi.

Smoke SMTP nyata lulus dari host dan worker Docker: setiap pesan diterima Mailpit
pada attempt pertama dan body diverifikasi melalui API dengan pencarian subject
unik. Schema pengujian dibersihkan; pesan capture tidak dihapus. Migration 011
serta API/web/worker diperbarui pada localnet dan Devnet tanpa reset data.
Readiness keduanya 200, akses notifikasi anonim 401/no-store; dua invoice Devnet
tetap paid, scanner healthy dan tidak ada alert pembayaran historis yang dibuat.
Kanal aktif Devnet masih kosong sehingga operator tetap mengisinya lewat admin.
Telegram dan SMTP publik belum diklaim teruji ke tujuan eksternal nyata.
