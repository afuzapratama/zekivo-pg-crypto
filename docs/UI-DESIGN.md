# UI dan developer experience Zekivo Pay

## Keputusan visual

Seluruh UI aplikasi memakai dasar **Tailwind CSS v4 + komponen shadcn/ui (New York/Radix)** yang disimpan di `apps/web/components/ui`. Tombol, input, label, badge dan card dipakai bersama pada homepage, dokumentasi, playground dan checkout. `components.json` dan alias `@/` tersedia untuk menambah komponen secara konsisten. Jangan memasang library komponen kedua untuk pola yang sama.

Token tema berada di `apps/web/app/globals.css`: background putih/abu netral, teks slate, aksen hijau Zekivo, border tipis dan radius 12 px. Struktur halaman yang khusus tetap memakai CSS Modules dengan token bersama. Tidak lagi menggunakan selector global seperti `section`, `nav` atau `article` yang dapat mengubah halaman lain tanpa sengaja. Ukuran target aksi utama minimal 44 px; alur checkout mempertahankan fokus keyboard, live status dan fallback manual.

Aset visual: **Lucide React** untuk ikon SVG, wordmark teks Zekivo dan monogram CSS. Font memakai sistem sehingga tidak membutuhkan request Google Fonts/CDN. Tidak menambahkan gambar dekoratif atau angka transaksi/saldo palsu. Homepage adalah developer overview, bukan dashboard admin; dashboard dengan autentikasi dan data operasional tetap Fase 7.

Alat operator port 4400 tetap merupakan HTML/TypeScript mandiri dengan tema yang sama, tanpa React/shadcn runtime. Ini mempertahankan pemisahan proses signing setup dari aplikasi gateway. Pesan hasilnya sekarang menjelaskan bahwa pembuatan ATA tidak mengirim USDC, dan bahwa `ready: true` berarti setup tidak perlu diulang.

## Scalar dan playground

- `/docs`: panduan integrasi invoice, matching, finality dan webhook.
- `/docs/api`: **Scalar API Reference React**, dimuat client-only dan secara dinamis; tidak dibundel ke checkout.
- `/api/openapi`: membaca schema dari API internal, tidak melalui signer/helper playground. Mengganti `servers` dengan API publik yang dikonfigurasi; pada localnet loopback memakai port 4100. Untuk staging, set `API_PUBLIC_URL`; alamat internal Docker tidak diberikan sebagai server browser.
- Scalar memakai kontrak OpenAPI aktual. Response schema belum seluruhnya lengkap; jangan menganggap response contoh kosong sebagai kontrak response final. Endpoint invoice mendokumentasikan header Idempotency-Key.
- Try it mengirim request langsung ke API. Operator memasukkan API key sandbox miliknya sendiri; tidak ada key merchant otomatis yang disisipkan. Telemetry, proxy Scalar, agent dan persistence auth dinonaktifkan. Tidak membutuhkan akun atau langganan Scalar untuk menampilkan referensi yang kita host sendiri.
- API membatasi CORS ke WEB_ORIGIN; development localnet juga mengizinkan hostname loopback pada port frontend yang sama. CORS tidak menggantikan autentikasi. Tidak mengaktifkan wildcard origin atau cookie credentials.
- `/docs/playground`: generator invoice, pengiriman mock localnet, checkout dan timeline webhook tetap alur aplikasi khusus. Scalar tidak menggantikan worker pembayaran, aturan finality, atau verifikasi webhook.

Pemisahan jaringan tetap eksplisit. Tampilan baru tidak mengaktifkan Devnet/Mainnet, mengubah kebijakan pencocokan, atau menambah signer treasury pada gateway. Playground otomatis tetap loopback/localnet.

## Menambah komponen

Jalankan CLI shadcn dari workspace web, tinjau perubahan dependency dan pertahankan token tema:

```sh
pnpm dlx shadcn@latest add <component> -c apps/web
```

Komponen awal diambil dari registry resmi shadcn New York; lisensi MIT disimpan di `apps/web/components/ui/LICENSE.md`. Dokumentasi: [shadcn Next.js](https://ui.shadcn.com/docs/installation/next), [Scalar React](https://scalar.com/products/api-references/integrations/react), [Scalar/Tailwind layer ordering](https://scalar.com/products/api-references/integrations/react#using-with-tailwind-css).

`vue-demi` adalah dependency transitif Scalar/Vue. Build script-nya dinonaktifkan eksplisit dalam pnpm workspace: distribusi sudah memakai Vue 3 yang sesuai dengan Scalar; tidak memberi izin menjalankan seluruh lifecycle script dependency.

## Kerangka dashboard admin

Dashboard memakai sidebar putih pada desktop, navigasi collapsible native details
pada mobile, canvas abu netral, header sticky dan tema hijau yang sama. Kartu
penerimaan bruto dibedakan dari saldo wallet/health checkpoint. Badge status
memakai warna sekaligus teks. Menu hanya menuju fitur tersedia; tidak ada tombol
export/aksi placeholder atau grafik data fiktif. Seluruh data finansial tetap
berasal dari API admin terotorisasi, dan receipt/ledger tidak berubah karena UI.
