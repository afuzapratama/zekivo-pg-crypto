# Pencatatan refund manual

Buka Invoice → detail invoice → **Riwayat refund**. Refund dikirim sendiri dari
wallet treasury di luar aplikasi. API, worker, dan dashboard tidak menyimpan
signer/private key, meminta seed phrase, atau melakukan broadcast transaksi.

## Alur operator

1. Pastikan invoice paid dan tentukan nominal sesuai kredit pembayaran pada aset
   yang sama. Periksa riwayat refund terlebih dahulu; pengembalian sebagian didukung.
2. Konfirmasi alamat owner Solana melalui kanal pembeli tepercaya, misalnya tiket
   dukungan yang sudah diautentikasi. Simpan nomor tiket/metode konfirmasi. Jangan
   menyimpulkan alamat pembeli dari fee payer atau menerima perubahan alamat
   hanya dari pesan yang belum diverifikasi.
3. Kirim token dari canonical ATA treasury untuk mint terkait ke canonical ATA
   alamat tujuan. Treasury memerlukan SOL pada cluster tersebut untuk fee. Pada
   Devnet gunakan USDC faucet atau Mock USDT, jangan mengirim token Mainnet.
4. Tunggu finalized. Buka transaksi di Explorer pada cluster yang sama, salin
   signature dan instruction path. Path top-level memakai indeks mulai nol,
   misalnya `2`; inner instruction pertama pada instruction 2 memakai `2.0`.
5. Isi nominal tepat (maksimal 6 desimal), alamat owner tujuan, alasan, bukti
   konfirmasi alamat dan checkbox konfirmasi. Klik **Verifikasi & catat refund**.
6. Periksa receipt confirmed beserta source/destination account, mint, slot,
   path, waktu verifikasi dan actor admin. Buka Explorer untuk pemeriksaan tambahan.

Checkbox/catatan adalah pernyataan admin telah memeriksa alamat melalui kanal
pembeli; **bukan verifikasi kriptografis identitas atau kepemilikan wallet**.
Verifikasi chain membuktikan instruksi token tertentu cocok dengan catatan.
Ini bukan analisis seluruh arus keluar/masuk atau saldo net seluruh transaksi.

## Aturan verifikasi

- Admin saja (`refund:write`), session Entra aktif, Origin dan CSRF sah,
  autentikasi Microsoft maksimal 10 menit terakhir. Operator/read-only dapat
  membaca riwayat dalam scope internal yang sudah ada.
- Konfigurasi mint, token program, 6 desimal, canonical ATA treasury dan genesis
  diverifikasi ulang melalui validator config yang dipakai scanner. Devnet tetap
  memeriksa mint USDC/Mock USDT yang dipin.
- `getTransaction` memakai `jsonParsed`, commitment `finalized`, version maksimum 0.
  Metadata eksekusi wajib tersedia, transaksi sukses dan tidak mendahului invoice.
- Instruksi SPL Token yang dipilih harus berasal dari token account treasury.
  Metadata source harus menunjukkan mint dan owner treasury yang benar.
- Destination wajib canonical ATA dari owner tujuan untuk mint tersebut; metadata
  destination, mint, decimals dan amount harus cocok. Transfer kembali ke treasury
  sendiri, SOL, token lain atau instruksi lain ditolak.
- RPC gagal, riwayat dipangkas, account config tidak dapat diverifikasi, metadata
  tidak tersedia atau transaksi belum finalized: 503, tidak ada catatan confirmed.
  Bukti bertentangan: 422. Jangan menganggap timeout sebagai refund gagal dikirim.
- Jumlah refund tercatat pada setiap aset tidak boleh melampaui kredit payment
  ledger invoice tersebut. Lock invoice menyerialisasi pencatatan bersamaan.
- `(environment, cluster, signature, instruction_path)` unik di seluruh invoice:
  satu instruksi tidak dapat dipakai dua kali. Instruksi berbeda pada transaksi
  yang sama dapat dicatat sesuai bukti masing-masing.
- Record dan `refund.confirmed` pada admin audit disimpan atomik. Record tidak
  dapat diedit/dihapus melalui API. Retry UUID yang sama dan payload sama mengembalikan
  record sebelumnya tanpa memerlukan RPC lagi; perubahan payload memakai UUID
  yang sama ditolak. Secret/session tidak disimpan pada receipt.

Status invoice tetap paid. Ledger payment dan penerimaan bruto Overview tidak
berubah; refund tersimpan sebagai register audit terpisah, **belum debit ledger
atau perhitungan net revenue**. Tidak ada event webhook refund atau email otomatis.

Batas pencatatan ini tidak mencegah seseorang mengirim dana berlebih dari wallet
secara langsung. Jika signature timeout saat submit, periksa riwayat lalu retry
payload/UUID yang sama; **jangan mengirim dana lagi**. Menekan submit hanya memeriksa
bukti, tidak mengirim transfer.

## Scope dan batas tahap ini

Hanya refund kredit invoice paid dalam aset sama dari treasury yang dikonfigurasi.
Pengembalian transfer unmatched/partial/overpaid tambahan yang belum menjadi
kredit ledger, token salah, non-canonical token accounts, treasury alternatif,
batch koreksi, pembatalan/persetujuan refund sebelum pengiriman dan ledger debit
memerlukan workflow terpisah. Jangan menandai review closed untuk menggantikan
catatan refund tersebut. Rekonsiliasi treasury penuh tetap F7-07b2c.

Bukti memakai satu provider RPC yang dikonfigurasi. Pembanding RPC independen
sebelum produksi tetap F8-10. Jika account treasury sudah ditutup atau histori
RPC tidak tersedia, verifikasi bisa unavailable walaupun transfer dulu sukses.
Tidak ada bypass manual menjadi confirmed.

## API internal

- `GET /admin/invoices/:id/refunds?before=<uuid>`: 25 receipt per halaman,
  cursor `(verified_at,id)`, total seluruh refund per aset, tanpa capability checkout.
- `POST /admin/invoices/:id/refunds`: header UUID `Idempotency-Key`, body
  `asset`, `amount` string desimal, `destination` owner address, `signature`,
  `instruction_path`, `reason` 10–2000 karakter, `destination_verification`
  10–1000 karakter, `destination_confirmed: true`.
- 201 confirmed baru; 200 retry; 400 input/cursor; 401/403 session/permission;
  404 invoice di luar scope; 409 request konflik, bukti duplikat, invoice belum
  paid atau melewati kredit; 422 bukti mismatch; 503 verifikasi unavailable.

Proxy Next hanya menerima UUID invoice dan Origin/Host sesuai WEB_ORIGIN, body
maksimal 12 KiB, no-store, tanpa redirect, timeout 60 detik. Setiap RPC dibatasi
15 detik, tanpa retry otomatis. Timeout proxy dapat mendahului hasil server;
idempotency dan pemeriksaan riwayat tetap diperlukan.

Migration `015_manual_refunds.sql` menambah register dan index; apply sebelum
API/web diperbarui. Readiness memeriksa migration tersebut. Tidak ada reset data,
perubahan key API atau pengiriman uang saat migration.

## Pengujian

Tes unit memeriksa exact finalized proof, CPI path, source/mint/owner/amount/
decimals, failed transaction, predates invoice, transfer ke diri sendiri dan
RPC/pruned metadata. Tes API memakai schema PostgreSQL terisolasi dan proof
fixture untuk menguji permission/fresh auth/CSRF, scope, replay, atomic audit,
concurrent cap, bukti unik lintas invoice, pagination, serta immutabilitas invoice,
ledger dan webhook. Browser fixture memeriksa mobile/desktop, read-only,
reauthentication dan respons mismatch/sukses. Tidak mengirim dana atau menambah
record palsu pada Devnet nyata. Bukti refund Devnet dengan wallet treasury operator
masih perlu diuji manual mengikuti alur di atas.

## Smoke test dengan blockchain lokal nyata

Jalankan dari host dengan `.env` local sesuai `.env.example` setelah validator,
PostgreSQL dan fixture sender tersedia (`pnpm local:up` / `local:seed-chain`).

```sh
pnpm local:refund-smoke
# Atau satu aset:
pnpm local:refund-smoke USDC
pnpm local:refund-smoke USDT
```

CLI menolak environment selain local/localnet dan RPC selain loopback/validator.
Smoke memakai schema PostgreSQL sementara, mint baru per run dan treasury fixture
khusus. Transaksi mint/pay/refund benar-benar ditandatangani **fixture lokal**,
bukan wallet operator. Fee payer adalah sender fixture; saldo SOL fixture harus
minimal 0.02 SOL, tidak ada airdrop/reset otomatis. Penandatangan ini tidak boleh
digunakan pada Devnet/Mainnet.

Pembayaran dan refund 0.1 token menunggu finalized, kemudian API admin in-process
memeriksa bukti dengan verifier asli dan RPC asli. Smoke memeriksa nominal salah
422, receipt 201, replay UUID 200, duplikasi bukti 409, invoice tetap paid,
satu kredit ledger, satu event pembayaran dan satu audit refund. Pengiriman
otomatis menunggu waktu block confirmed melewati waktu invoice, tanpa mengubah
created_at/activated_at atau melonggarkan matching. Jika pembayaran tidak settle,
smoke berhenti sebelum mengirim refund dan memberi status/disposition diagnosis.

Schema dijatuhkan setelah selesai/gagal; invoice/token config operasional tidak
diubah. Mint/ATA dan transaksi uji tetap ada di validator lokal dan memakai sedikit
SOL fixture. Worker operasional tidak memantau mint baru ini. Hasil sukses ditulis
ke `test-results/refund-chain-smoke.json` setelah cleanup selesai, berisi signature
publik dan hasil assertion tanpa session/CSRF/private key. Database receipt sementara
sudah tidak ada, sehingga tautan invoice ID pada hasil bukan invoice dashboard aktif.
Riwayat lokal lama yang dipangkas tidak dipakai atau diperbaiki/reset oleh smoke.

## Persiapan dan inspeksi refund Devnet

Alat berikut **hanya membaca** `.env.devnet`, database project yang dikonfigurasi,
dan RPC. Koneksi PostgreSQL dipaksa `default_transaction_read_only=on`. Tidak ada
transfer, signature request, API mutation atau pencatatan refund otomatis.

```sh
pnpm devnet:refund-inspect <invoice-id> <alamat-owner-tujuan> 0.1
# Setelah transfer dari Phantom finalized:
pnpm devnet:refund-inspect <invoice-id> <alamat-owner-tujuan> 0.1 <signature>
```

Tanpa signature: periksa status paid, mint, treasury/destination ATA, kredit
pembayaran, refund tercatat, sisa kredit, saldo token treasury dan SOL. Notes
adalah petunjuk kesiapan, bukan estimasi fee, jaminan kecukupan gas atau bukti
identitas tujuan. Kondisi saldo dapat berubah setelah pemeriksaan.

Dengan signature: cari tepat satu instruksi finalized dengan nominal+tujuan yang
cocok, lalu verifier refund memeriksa source/mint/owner/time sebagaimana API.
Tampilkan instruction path, slot, waktu block, apakah bukti sudah dicatat, dan
URL dashboard. Jika ada beberapa instruksi nominal sama, inspeksi manual diperlukan;
tidak otomatis memilih salah satunya. Hasil verifikasi tetap harus dicatat melalui
admin dengan konfirmasi alamat dan alasan. Jangan mengirim dana lagi karena
verifikasi unavailable.

Pada pemeriksaan Devnet 17 Oktober 2026, invoice USDC
`e2725f58-8604-4ee6-9bc2-3a09cb1a54f9` masih paid, saldo treasury/kredit
1.000001 USDC, refund tercatat 0 dan treasury memiliki **0 lamport SOL**. Alamat
owner treasury `GGQtua3Q7Sdr4K3eCvJA7kiHXCsTCgGBrm7FqoJsPEkk` perlu menerima SOL
Devnet sebelum mengirim refund lewat Phantom. Ini snapshot pemeriksaan, bukan
saldo real-time. Untuk uji 0.1 USDC, konfirmasi kembali alamat buyer
`3toF4H23Winv3CehGrxW7CaqMuFcbQVRfaDoa8upVLkt` melalui akun pembeli, pilih akun PG
di Phantom dan pastikan Devnet, lalu lakukan transfer manual dan simpan signature.
Jangan kirim token asli. Uji refund Devnet nyata masih belum dilakukan otomatis.

Uji wallet refund Devnet manual dilewati atas arahan operator. Bukti lokal tetap berlaku; tidak menyatakan refund Devnet nyata sudah teruji dan tidak menghambat staging webhook.
