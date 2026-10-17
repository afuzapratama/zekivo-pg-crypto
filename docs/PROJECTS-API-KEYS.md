# Project dan API key admin

Satu **project** mewakili satu integrasi website/aplikasi, misalnya Zekivo Commerce.
Tenant Entra mewakili identitas perusahaan, bukan nama website. Beberapa website
nanti dapat memakai project berbeda, dengan invoice, credential dan endpoint
webhook masing-masing. Project saat ini berisi nama dan ID; domain/site tenancy
serta pengaturan merchant publik belum menjadi bagian implementasi ini.

## Dashboard

Buka **Projects** pada sidebar atau `/dashboard/projects`. Admin dapat membuat
project dan membuka detailnya, dengan Overview serta API keys. Operator dan
read-only dapat membaca project/metadata key pada environment yang diizinkan,
tetapi tidak memiliki aksi create/revoke. Grant baca per project masih mengikuti
backlog F7-02; filter project bukan grant otorisasi.

API key lengkap hanya dikembalikan pada respons sukses penerbitan pertama. UI
menyimpannya sementara dalam state, tidak di localStorage/sessionStorage, lalu
menghapusnya dari tampilan setelah **Sudah disimpan** atau ketika halaman dimuat
ulang. Simpan key dalam environment backend website/secret manager. Database
menyimpan hash SHA-256 dan metadata nama/prefix, tanpa salinan key lengkap.
Prefix adalah potongan awal untuk mengenali key, bukan credential yang cukup
untuk autentikasi. Key lama tetap aktif, mendapat nama Legacy API key dan prefix
kosong karena hash tidak bisa dikembalikan menjadi key asal.

Pencabutan memerlukan konfirmasi eksplisit. Setelah dicabut, permintaan merchant
baru langsung mendapat 401. Invoice/pembayaran lama tidak dihapus dan tidak
menjadi batal; checkout existing tetap mengikuti pembayaran chain. Pencabutan
key yang sedang dipakai CLI/backend membuat integrasi tersebut perlu memakai
key aktif yang lain. Generate biasa tidak mengubah key lain; workflow Rotasi key
menjadwalkan expiry key lama dan menerbitkan pengganti. History metadata berhalaman 100 key, cursor created_at+id.

## Otorisasi, CSRF dan verifikasi ulang

POST admin memerlukan permission project:manage, Origin WEB_ORIGIN yang tepat,
X-CSRF-Token milik session dan autentikasi Microsoft maksimal 10 menit terakhir.
`authenticated_at` berasal dari auth_time dalam ID token yang diverifikasi;
bukan waktu browser membuka halaman atau sekadar waktu session dibuat.
Login meminta prompt=login/max_age=0 dan memvalidasi auth_time melalui openid-client
maxAge. Lihat [kontrak library](https://github.com/panva/openid-client/blob/main/docs/functions/authorizationCodeGrant.md)
dan [implementasi validasi auth_time MSAL Microsoft](https://github.com/AzureAD/microsoft-authentication-library-for-python/blob/dev/msal/oauth2cli/oidc.py).
MFA tetap mengikuti kebijakan tenant, bukan diasumsikan dari autentikasi ulang.

Session sebelum migration 009 tetap boleh membaca, tetapi tidak mendapat
privilege tulis baru secara otomatis. Klik **Verifikasi ulang Microsoft** di UI
(`/login?reauth=1`), login dan buka kembali project. Aksi pending tidak dieksekusi
otomatis sesudah login ulang. Validasi provider/fresh auth pada tenant nyata
masih memerlukan operator menyelesaikan flow baru ini.

## API admin internal

| Method | Endpoint                                   | Perilaku                                           |
| ------ | ------------------------------------------ | -------------------------------------------------- |
| GET    | /admin/projects                            | Project environment saat ini                       |
| GET    | /admin/projects/:id?before_key=UUID        | Detail, counts invoice dan metadata key berhalaman |
| POST   | /admin/projects                            | Body name, permission admin + fresh auth           |
| POST   | /admin/projects/:id/api-keys               | Body name; key lengkap hanya sekali                |
| POST   | /admin/projects/:id/api-keys/:keyId/revoke | Cabut idempotent; key harus milik project tersebut |

Create project/key membutuhkan header Idempotency-Key berupa UUID. Identitas
request dibatasi actor + environment + cluster dan hash payload ter-normalisasi.
Retry create project yang sama mengembalikan ID project yang sama. Retry generate
key yang sudah commit memberi 409 key_already_created dengan ID key, tanpa
mengeluarkan secret kembali atau membuat key kedua. Perubahan payload dengan
request ID sama mendapat idempotency_conflict. Request yang bersamaan memakai
constraint DB agar hanya satu penerbitan berhasil.

Client tidak melakukan retry otomatis. Bila respons key hilang, periksa metadata;
jika belum disimpan, cabut key tersebut dan buat permintaan baru. Aksi key dan
audit actor/tenant/project/entity ditulis dalam satu transaksi PostgreSQL.
Revoke yang diulang tidak menggandakan audit atau menghidupkan kembali key.
Data project lain environment ditolak 404; cursor key dari project berbeda
mendapat 400. Proxy web hanya meneruskan rute mutasi yang di-allowlist, membatasi
body 4 KiB, menolak Origin/Host asing, memakai no-store dan tidak memakai merchant
API key. Header/body respons secret tidak ditulis ke log aplikasi.

## Migration dan batas tahap ini

Migration 009 menambah metadata key, authenticated_at session, scope audit,
journal idempotency admin dan index pagination key. Tidak mengubah hash/key lama,
invoice, ledger, saldo, token config atau checkpoint. Apply sebelum menjalankan
API baru; readiness saat ini memeriksa migration 014 untuk expiry credential.

Pengaturan endpoint webhook HTTPS, rotation signing secret, delivery log dan
replay admin tersedia di tab Webhooks, dengan audit/CSRF/fresh auth yang sesuai. Tidak ada endpoint atau signing secret webhook
baru yang otomatis dibuat pada Devnet.

## Verifikasi dan rollout

144 tes backend pada 19 file serta 21 tes browser dashboard/project pada tiga
viewport lulus. Typecheck, lint terkait, format dan build workspace lulus.
Tes mencakup role/Origin/CSRF/fresh auth, hash/prefix, secret sekali respons,
concurrent retry, revoke langsung menolak merchant, isolasi environment, cursor
history key dan audit atomik. Browser memverifikasi create project, generate/ack
secret/revoke, konfirmasi batal, read-only dan jalur reauthentication. Seluruh
mutasi pengujian berada pada schema PostgreSQL atau fixture API yang terisolasi.
Screenshot [desktop](qa/admin-project-desktop-fixture.png) dan
[mobile](qa/admin-project-mobile-fixture.png) menggunakan fixture, bukan key nyata.

Migration 009 diterapkan pada DB localnet dan Devnet, lalu API/web diperbarui.
Smoke Devnet readiness 200; create project anonim ditolak 401; halaman project
anonim menuju login. API key Devnet lama tetap berfungsi untuk membaca kedua
invoice paid USDC/Mock USDT. Tidak ada project/key Devnet yang diterbitkan atau
dicabut oleh pengujian. Discovery issuer untuk flow baru berhasil dengan
prompt=login, max_age=0 dan PKCE S256. Fresh-auth callback sesungguhnya tetap
menunggu operator menyelesaikan login Microsoft, tanpa menyuntik timestamp ke
session lama. Webhook settings kini tersedia dari tab Webhooks pada detail project; lihat [WEBHOOKS.md](WEBHOOKS.md).

## Navigasi API keys

Tab API keys kini membuka halaman `/dashboard/projects/:id/api-keys` dengan
penanda tab aktif, bukan anchor yang menggulir halaman Overview. Overview,
API keys dan Webhooks memiliki URL masing-masing. Generate/revoke tetap
mengikuti role admin dan fresh auth yang sudah berlaku.

## Rotasi API key dengan masa transisi

Pada Projects → API keys, buka **Rotasi key** di key aktif. Isi nama pengganti dan
pilih 1, 24, atau 72 jam. Setelah diterbitkan, simpan key pengganti yang tampil
sekali, pasang di backend integrasi, lalu uji request. Key lama otomatis ditolak
oleh autentikasi merchant setelah `expires_at` menurut waktu database, tanpa
menunggu worker. Cabut key lama lebih awal jika seluruh integrasi sudah berpindah.

`POST /admin/projects/:projectId/api-keys/:keyId/rotate` menerima
`{name, overlap_hours}` dan UUID `Idempotency-Key`. Permission `project:manage`,
Origin, CSRF dan autentikasi Microsoft terbaru tetap diwajibkan. Jadwal expiry,
key pengganti (hash saja), hubungan `replaces_key_id`, journal request dan audit
`api_key.rotation_started`/`api_key.created` disimpan dalam satu transaksi.
Satu key hanya bisa memiliki satu pengganti. Key dicabut atau sudah dijadwalkan
expiry tidak bisa dirotasi lagi. Retry tidak menampilkan ulang plaintext.

Batas waktu dimulai saat penerbitan, bukan saat tombol Sudah disimpan ditekan.
Tidak ada perpanjangan otomatis atau pembatalan jadwal. Jika respons hilang/key
belum disimpan, periksa daftar, cabut pengganti yang tidak dapat dipakai lalu
terbitkan key baru dari formulir biasa sebelum key lama berakhir. Jangan menunggu
expiry bila credential bocor: cabut segera. Ini workflow operator; aplikasi tidak
mengubah credential di website merchant secara otomatis.

Migration `014_api_key_rotation.sql` harus diterapkan sebelum menjalankan versi
API ini, termasuk instance tanpa login admin. Readiness memeriksa migration baru.
Pengujian hanya menerbitkan/merotasi key pada schema fixture terisolasi; key asli
Devnet tidak diubah.
