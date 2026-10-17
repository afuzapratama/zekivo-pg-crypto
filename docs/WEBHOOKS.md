# Webhook v1 — development

Status: enam event lifecycle tersedia melalui outbox. Delivery localnet terverifikasi; delivery HTTPS merchant Devnet masih perlu pengujian staging. Mainnet tetap dinonaktifkan.

## Alur

Finalized transfer mengubah invoice paid, mencatat ledger dan menulis event outbox dalam satu transaksi. Worker materialisasi satu delivery per event/endpoint yang aktif dan sudah terdaftar saat event dibuat. Event lama sebelum endpoint didaftarkan tidak dikirim retroaktif. Gangguan endpoint tidak mengubah status pembayaran.

Loop dispatcher terpisah dari scanner. Job diklaim dengan row lock SKIP LOCKED, lease 45 detik dan token pemilik. Worker lain dapat melanjutkan lease yang expired; worker lama tidak dapat menimpa hasil pemilik baru. Setiap upaya tercatat tersendiri.

HTTP deadline 10 detik mencakup DNS, koneksi, TLS dan response body. 2xx selesai; non-2xx, redirect, timeout atau kegagalan jaringan dijadwalkan ulang. Respons maksimal 4 KiB, body respons tidak disimpan. Retry exponential backoff dari basis 10 detik dengan jitter 80–100%, maksimum 1 jam per interval. Setelah 24 jam sejak cycle dimulai, delivery menjadi dead. Replay membuat cycle baru dengan event_id/payload tetap, attempt history tetap tersimpan dan audit log baru.

Pengiriman bisa duplikat dan tidak berurutan. Receiver harus memverifikasi signature serta commit event receipt dan perubahan order atomik sebelum memberi 2xx. Gunakan event_id untuk dedup, invoice_id/order_id untuk identitas order dan invoice_version untuk menolak state usang. Paid tidak boleh diturunkan oleh event expired yang terlambat. Perbedaan state memerlukan rekonsiliasi GET invoice; jangan memenuhi order berdasarkan redirect browser.

## Signature

Header:

- `Zekivo-Timestamp`: Unix seconds saat attempt ditandatangani.
- `Zekivo-Signature`: hex HMAC-SHA256 atas `timestamp + "." + rawBody`.
- `Zekivo-Event-Id`: ID event stabil; verifikasi juga ID dalam body yang sudah diautentikasi.

Verifikasi raw body sebelum JSON parsing/normalisasi. Bandingkan digest secara constant-time dan tolak timestamp di luar toleransi 300 detik. Retry/replay menandatangani ulang dengan waktu saat itu. Receiver contoh ada di `apps/webhook-receiver`; helper crypto di `packages/webhooks`.

Payload mencakup event_id, event_type, schema_version, occurred_at, project_id dan data invoice/order, asset/mint/cluster, jumlah string, transfer signature/instruction path serta finality. Event confirmed baru memakai invoice_version hasil commit pembayaran dan menyertakan attempt_id. Versi meningkat pada pemilihan aset, expiry, paid dan setiap observasi transfer terkait invoice. Event historis tetap valid. Review dengan versi lebih tinggi dapat tiba sebelum confirmed: jangan membuang bukti confirmed yang valid hanya karena nomor versi lebih kecil; rekonsiliasi dengan API dan proses fulfillment atomik sekali.

Secret endpoint disimpan dengan AES-256-GCM. `WEBHOOK_ENCRYPTION_KEY` adalah key 32 byte dalam bentuk 64 digit hex, di luar database. Kehilangan atau menggantinya tanpa re-enkripsi membuat secret lama tidak bisa dibaca. Secret signing hanya ditampilkan saat create/rotate. Untuk rotasi, siapkan receiver menerima key baru (dan key sebelumnya selama masa transisi), kemudian hentikan penerimaan key lama setelah retry lama ditangani. Signing attempt berikutnya mengambil secret endpoint terkini. Fixture local inbox memakai secret tetap dan tidak dirotasi melalui API.

## API merchant

Semua rute memerlukan Bearer API key project dan mengikuti isolasi environment/project yang sama dengan invoice API. OpenAPI tersedia di `/openapi.json`.

| Metode | Rute                                    | Fungsi                                                                     |
| ------ | --------------------------------------- | -------------------------------------------------------------------------- |
| POST   | /v1/webhook-endpoints                   | Register URL HTTPS; signing_secret ditampilkan sekali.                     |
| GET    | /v1/webhook-endpoints                   | Daftar endpoint milik project tanpa ciphertext/secret.                     |
| POST   | /v1/webhook-endpoints/:id/rotate-secret | Rotasi secret endpoint eksternal, tercatat di audit.                       |
| GET    | /v1/webhook-deliveries                  | Filter invoice_id, limit 1–100, before cursor ID untuk halaman berikutnya. |
| GET    | /v1/webhook-deliveries/:id/attempts     | Riwayat maksimal 100 upaya terbaru.                                        |
| POST   | /v1/webhook-deliveries/:id/replay       | Replay pending/dead/delivered. Inflight dengan lease aktif mendapat 409.   |

Endpoint eksternal hanya HTTPS port 443 tanpa userinfo/fragment. DNS diperiksa saat registrasi dan setiap attempt. Seluruh hasil DNS harus alamat publik; private, loopback, link-local, metadata, multicast dan reserved ditolak. Koneksi memakai IP yang sudah diverifikasi, Host/SNI asli dan verifikasi sertifikat TLS. Redirect tidak diikuti.

## Receiver dan smoke lokal

Compose menyediakan `webhook-receiver` di http://localhost:4200. Hanya fixture seed local/localnet yang bisa memakai HTTP ke URL tepat `/webhooks/zekivo` pada receiver lokal. API pendaftaran endpoint tidak menerima pengecualian ini. Receiver memakai tabel demo terpisah pada PostgreSQL lokal; ini bukan backend Zekivo produksi.

```sh
docker compose exec api pnpm local:webhook-smoke
```

Smoke membuat invoice baru melalui HTTP API, mengirim mock token, menunggu dispatcher mengirim event, memeriksa inbox/order demo, lalu replay untuk memastikan fulfillment tetap satu kali. Kasus kedua membuat receiver commit lalu menunda ACK 11 detik; deadline sender 10 detik memicu retry dan event yang sama tidak memenuhi order dua kali. Jalankan smoke ini secara serial karena fault control receiver lokal berlaku untuk request berikutnya.

```sh
curl http://localhost:4200/test/inbox \
  -H 'Authorization: Bearer local_receiver_control_only'

curl http://localhost:4100/v1/webhook-deliveries \
  -H 'Authorization: Bearer zk_local_development_only'
```

Fault control khusus receiver lokal:

```sh
curl -X POST http://localhost:4200/test/control \
  -H 'Authorization: Bearer local_receiver_control_only' \
  -H 'Content-Type: application/json' \
  -d '{"mode":"before_commit","remaining":1}'
```

Mode: none, before_commit (503 sebelum menyimpan event), after_commit (503 setelah commit), timeout_after_commit (ACK ditunda 11 detik). Control/inbox memerlukan token fixture dan tidak didaftarkan pada API gateway. Native development: salin variabel terbaru `.env.example`, jalankan receiver dengan `pnpm dev`; receiver memakai HOST konfigurasi (default loopback). Compose memetakan port ke loopback host.

Kredensial contoh `.env.example`/Compose hanya untuk development. Aplikasi menolak mainnet/production; receiver demo menolak environment selain local saat dijalankan sebagai service. OIDC/RBAC dan manajemen webhook tersedia melalui dashboard project; deployment produksi tetap mengikuti gate roadmap.

Referensi implementasi: [Node.js Crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html), [Node.js HTTP](https://nodejs.org/docs/latest-v24.x/api/http.html), [Node.js HTTPS](https://nodejs.org/docs/latest-v24.x/api/https.html).

## Dashboard webhook per project

Buka **Dashboard → Projects → pilih project → Webhooks**. Admin dapat
mendaftarkan endpoint HTTPS publik dan merotasi signing secret. Operator dan
admin dapat melakukan replay; read-only hanya melihat metadata, delivery, dan
attempt. Semua write memerlukan Origin, CSRF, login Microsoft dengan `auth_time`
maksimal 10 menit, dan UUID `Idempotency-Key`. Audit merchant dan identitas admin
dicatat dalam transaksi yang sama dengan perubahan.

Secret lengkap hanya tersedia pada respons create/rotate, tidak tersedia melalui
GET, dan disimpan dengan AES-256-GCM. Salin ke backend receiver lalu pilih **Sudah
disimpan** untuk menghapusnya dari tampilan. Rotasi langsung mengganti secret
lama, termasuk untuk retry berikutnya; koordinasikan pembaruan pada receiver.
Jika respons hilang, retry UUID yang sama tidak merotasi ulang dan tidak
mengembalikan secret. Periksa endpoint lalu muat ulang halaman untuk memulai
rotasi baru bila secret benar-benar hilang. Jangan mengganti encryption key API
sebagai cara merotasi signing secret.

Route admin (session cookie, bukan API key merchant):

- `GET /admin/projects/:projectId/webhooks?before=<delivery_id>`: 25 delivery
  dengan cursor, 100 endpoint terbaru beserta flag jika masih ada endpoint lain.
- `POST /admin/projects/:projectId/webhook-endpoints`: body `{ "url": "https://..." }`.
- `POST /admin/projects/:projectId/webhook-endpoints/:id/rotate-secret`: body `{}`.
- `GET /admin/projects/:projectId/webhook-deliveries/:id/attempts`: 100 percobaan
  terbaru pada UI, ditandai jika masih ada riwayat lain.
- `POST /admin/projects/:projectId/webhook-deliveries/:id/replay`: body `{}`;
  mengantrekan ulang event yang sama, bukan membuat pembayaran/event baru.

Project dibatasi environment dan delivery dibatasi cluster invoice. Filter ini
belum merupakan grant akses per project: operator internal yang diizinkan tetap
bisa membaca seluruh project di environment tersebut. Endpoint local-inbox
fixture tidak dapat dirotasi melalui UI.

Devnet menerima `WEBHOOK_ENCRYPTION_KEY` hanya pada service API untuk pengaturan.
`WEBHOOK_DELIVERY=false` tetap berlaku: replay dapat masuk antrean tetapi belum
terkirim. Pengaktifan worker, penyediaan key yang sama pada worker dan pengujian
receiver HTTPS nyata masih gate tersendiri. Mendaftarkan endpoint hanya berlaku
untuk event baru; tidak mematerialisasi delivery historis secara otomatis.

## Event lifecycle tambahan

| Event                     | Pemicu                                                                    | Fulfillment                             |
| ------------------------- | ------------------------------------------------------------------------- | --------------------------------------- |
| `payment.confirmed`       | Pembayaran finalized cocok, kredit ledger dan invoice paid atomik         | Sekali setelah validasi pesanan backend |
| `payment.expired`         | Pending melewati expires_at pada job expiry                               | Tidak                                   |
| `payment.partial`         | Reference mengidentifikasi satu invoice, nominal lebih kecil              | Tidak                                   |
| `payment.overpaid`        | Reference mengidentifikasi satu invoice, nominal lebih besar              | Tidak                                   |
| `payment.late`            | Nominal cocok, block time melewati expiry                                 | Tidak                                   |
| `payment.review_required` | duplicate_payment, reference_conflict, inactive_attempt, predates_invoice | Tidak                                   |

Manual exact amount yang tidak cocok dengan nominal reservasi tidak dapat
mengidentifikasi invoice secara aman: tetap unmatched/internal. Beberapa reference
invoice berbeda tetap ambiguous/internal. Partial tidak diakumulasi otomatis.
Klasifikasi mengikuti disposition scanner: apabila nominal tidak tepat, partial/
overpaid diutamakan sebelum pemeriksaan late/duplicate yang memerlukan nominal cocok.
Review tidak mengubah status invoice atau menciptakan kredit ledger.

Review/partial/overpaid/late membawa `transfer_id` string, `attempt_id`, `reason`,
`invoice_status`, amount_expected/amount_received string 6 desimal, `asset/mint/recipient`
yang diharapkan dan `received_asset/received_mint/received_recipient` aktual.
Perbedaan ini penting pada reference_conflict. Jangan menganggap amount_received
sebagai saldo, agregat pembayaran, atau kredit ledger. Semua event transfer ini
memakai finality finalized dan signature/instruction_path/slot. Satu instruksi
baru menghasilkan satu event; replay scanner tidak menghasilkan event kedua.

Expiry membawa expires_at dan transfers kosong, tanpa klaim finality/amount_received.
Job memproses maksimal 100 invoice per tick, hanya environment+cluster instance,
row lock SKIP LOCKED. Perubahan expired/version dan outbox dalam satu transaksi.
Pembayaran on-time yang baru ditemukan setelah expiry tetap dapat menjadi paid;
urutannya expired → confirmed, dengan versi lebih tinggi. Late tidak menjadi paid.
Expired dan confirmed masing-masing unik per invoice; review berulang diperbolehkan
untuk transfer berbeda. Semua perubahan ke transfer/version/ledger/outbox rollback
bersama jika insert event gagal. Tidak backfill event untuk review/expiry historis.

Migration 016 mengubah unique constraint umum menjadi index terminal event dan
index transfer event. Terapkan sebelum worker/API baru; readiness memeriksa 016.
Receiver demo menerima enam event, menyimpan receipt dan fulfillment sekali,
mempertahankan paid walau review/expiry datang belakangan. Demo ini tetap sandbox;
validasi harga/order/aset/nominal terhadap pesanan backend Zekivo harus dilakukan
pada integrasi merchant sesungguhnya sebelum staging end-to-end dianggap lulus.
`payment.detected` menunggu observasi pre-finality; refund webhook belum tersedia.
