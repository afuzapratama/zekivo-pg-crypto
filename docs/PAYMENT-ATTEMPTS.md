# Pilihan aset dan payment attempt

Invoice tetap satu per order. Merchant dapat memberikan quote USDT dan USDC secara eksplisit; gateway tidak menghitung kurs atau menganggap kedua token memiliki harga identik. Tanpa payment_options, invoice tetap satu aset seperti sebelumnya.

```sh
curl -s http://localhost:4100/v1/invoices \
  -H 'Authorization: Bearer zk_local_development_only' \
  -H 'Idempotency-Key: example-two-assets-1' \
  -H 'Content-Type: application/json' \
  -d '{"order_id":"example-two-assets-1","asset":"USDT","amount":"25","payment_options":[{"asset":"USDT","amount":"25"},{"asset":"USDC","amount":"24.9"}]}'
```

Buka checkout_url dari response. Bagian **Ganti aset pembayaran** menampilkan pilihan alternatif dan nominal dasar yang disetujui merchant. Pembeli mengonfirmasi belum mengirim sebelum mengganti pilihan. Setelah server mengonfirmasi perubahan, checkout memuat alamat/mint/reference/nominal persis dan QR terbaru. Jangan mengirim dua kali; pilihan sebelumnya tetap dipantau.

## Kontrak

- payment_options opsional, satu atau dua object asset/amount. Asset harus berbeda dan pilihan awal harus disertakan dengan amount yang sama. Field tambahan, token lain dan precision lebih dari enam digit ditolak. Harga pilihan tidak dapat ditambah atau diubah melalui checkout.
- Nominal quote dinormalisasi sebelum hashing idempotency. Urutan pilihan tidak berpengaruh; perubahan harga salah satu aset dengan key yang sama mendapat conflict. Request lama tanpa payment_options tetap memakai aturan hash sebelumnya.
- Setiap aset memiliki satu attempt dengan reference dan nominal persis historis sendiri. Dua attempt direservasi atomik saat invoice dibuat; kegagalan reservasi membatalkan seluruh invoice. Quote alternatif baru diaktifkan saat dipilih. Kembali ke aset awal menggunakan attempt lama, bukan nominal/reference baru.
- Reservasi nominal berlaku lintas project, termasuk attempt tidak aktif, expired dan paid. Mint/penerima/quote/reference/deadline attempt tidak diubah oleh pemilihan aset.
- GET /v1/checkout mengembalikan invoice_version dan payment_options berisi asset/amount dasar. Hanya rincian transfer pilihan saat ini yang tampil. Token checkout kini mengizinkan baca invoice dan pemilihan quote yang disetujui merchant; tidak memberikan akses API merchant, perubahan harga atau mark paid.
- POST /v1/checkout/asset memakai header X-Checkout-Token dan JSON asset/expected_version. expected_version wajib sesuai snapshot terakhir. Lock invoice dan versi optimistis mencegah dua tab menimpa pilihan diam-diam. Harga/jumlah dari browser ditolak.
- Proxy web POST /api/checkout/asset mewajibkan origin sama, JSON kecil maksimal 1 KiB, token valid dan body terbatas. Tidak meneruskan API key merchant. Kegagalan/timeout memicu refresh status; browser tidak mencoba ulang perubahan pilihan secara buta.
- Pilihan hanya terbuka pada invoice pending, enabled, belum mencapai deadline dan belum memiliki transfer yang terhubung. Paid/confirming/expired/review ditolak. Pergantian aset tidak memperpanjang expiry. Expiry dan pembayaran dapat menaikkan invoice_version; event confirmed memakai versi hasil commit pembayaran.

## Pencocokan dan pembayaran ganda

Scanner mencocokkan seluruh attempt historis, bukan hanya snapshot pilihan invoice saat ini. Transfer ke pilihan lama yang pernah diaktifkan tetap dapat melunasi invoice bila mint, penerima, nominal, timestamp dan finalized valid dalam deadline awal. Invoice dan webhook kemudian menampilkan aset yang benar-benar dibayar, termasuk attempt_id pada payment.confirmed.

Transfer ke quote yang belum pernah diaktifkan masuk review inactive_attempt. Timestamp transfer sebelum aktivasi masuk predates_invoice review. Konflik reference tidak fallback ke exact amount invoice lain. Beberapa reference yang ambigu tidak otomatis dialokasikan.

Dua transfer lintas aset yang sama-sama valid bersaing untuk satu invoice: yang pertama diproses dan valid menjadi kredit; berikutnya menjadi duplicate_payment review. Tabel ledger juga membatasi satu entry payment per invoice. Tidak ada penggabungan parsial, konversi atau refund otomatis. Operator tetap perlu menindaklanjuti dana tambahan. Satu event confirmed dan satu fulfillment merchant tetap dipertahankan.

## Development dan migration

Migration 005 mem-backfill satu attempt untuk seluruh invoice lama, termasuk disabled, serta menghubungkan transfer lama. Tidak mengaktifkan placeholder atau menghapus reservasi/ledger. Karena kode lama belum menulis attempt, deployment harus terkoordinasi: hentikan invoice creation/worker lama, jalankan migration dengan image baru, lalu hidupkan API/worker baru bersama. Jangan menjalankan penulis invoice versi lama setelah migration; rollback aplikasi lama memerlukan rencana kompatibilitas, bukan penghapusan histori.

Compose lokal sudah diperbarui tanpa reset volume. Pada checkout baru, gunakan payment_options untuk melihat pilihan aset; invoice lama tetap hanya mempunyai satu quote.

```sh
# Pilihan saat ini:
docker compose exec api pnpm local:pay <invoice-id>
# Simulasi transfer ke pilihan lama setelah mengganti aset:
docker compose exec api pnpm local:pay <invoice-id> --asset USDT
# Simulasi pembayaran kedua dengan aset lain tanpa reference:
docker compose exec api pnpm local:pay <invoice-id> --asset USDC --manual
```

CLI tetap hanya local/localnet dan signer mock. Test domain mencakup harga berbeda, immutable reservations, stale version/concurrency, switch-back, pembayaran pilihan lama, unactivated quote, review/expiry dan race lintas aset. Suite browser mencakup QR baru, penolakan konflik dan proxy security; suite chain menambah skenario pergantian aset → pembayaran pilihan lama → pembayaran kedua → satu signed event/fulfillment.
