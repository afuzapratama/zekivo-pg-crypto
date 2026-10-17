# Akses dashboard operator

Status: fondasi Entra OIDC, session database dan role tersedia. Login Entra nyata
serta MFA masih menunggu konfigurasi dan verifikasi tenant Zekivo. Dashboard baru
menyediakan area akses terlindungi; overview invoice/review belum diimplementasikan.
Default autentikasi **disabled**, bukan login development otomatis.

## Alur dan batas kepercayaan

`/login` memulai POST same-origin ke `/api/admin/auth/login`. Proxy web meneruskan
ke API `/admin/auth/login`, lalu browser diarahkan ke Microsoft. Authorization
Code menggunakan PKCE S256, state dan nonce. Callback terdaftar harus menuju
`/api/admin/auth/callback` pada origin web yang tepat. Discovery memakai issuer
single-tenant `https://login.microsoftonline.com/<tenant-id>/v2.0`, bukan common.
Validasi protokol/token memakai `openid-client`; tenant dan object ID pengguna
kemudian diperiksa lagi terhadap allowlist aplikasi. Pola state/nonce/PKCE mengikuti
[dokumentasi openid-client](https://github.com/panva/openid-client/blob/main/docs/functions/authorizationCodeGrant.md).
Identitas memakai tenant/object ID, bukan email yang dapat berubah, sesuai
[panduan klaim Microsoft](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference).

Login request disimpan di DB selama 10 menit, terikat cookie acak HttpOnly dan
hanya dapat dikonsumsi sekali. Session memakai token acak 256-bit; hanya SHA-256
hash token disimpan di DB. Access/refresh/ID token Entra tidak disimpan. Session
berlaku absolut satu jam, tidak memakai sliding refresh. Login ulang merotasi
session browser yang ada. Cookie HttpOnly, SameSite=Lax, Path=/, tanpa Domain;
Secure pada staging atau origin HTTPS. Nama cookie berbeda per environment/cluster.
Localnet dan Devnet tetap harus memakai DB/config sendiri; port berbeda saja
bukan isolasi cookie pada hostname yang sama.

`GET /admin/auth/session` selalu memeriksa expiry/revocation dan allowlist/role
terkini. Session admin tidak memberi API key merchant dan tidak dapat mengubah
status paid. Role:

| Role      | Permission fondasi                           |
| --------- | -------------------------------------------- |
| read-only | dashboard:read                               |
| operator  | dashboard:read, review:write, webhook:replay |
| admin     | Seluruh permission operator + project:manage |

Permission ini baru kontrak akses. Endpoint manajemen sensitif belum tersedia;
setiap endpoint tersebut wajib menegakkan permission di server saat dibangun.
UI dashboard memerlukan session dan dashboard:read pada server, bukan sekadar
menyembunyikan tombol di browser. Scope project untuk fungsi admin dan audit
seluruh perubahan sensitif tetap pekerjaan F7-02/F7-06 berikutnya.

Logout memakai POST dengan Origin yang tepat dan header X-CSRF-Token dari session.
Logout mencabut session di DB dan menghapus cookie. Ini logout aplikasi lokal,
bukan mengakhiri semua session Microsoft/SSO. Login/logout dicatat ke tabel
admin_audit_logs terpisah. Retensi/pembersihan session dan audit, idle timeout,
reauth untuk operasi berisiko dan revoke-all operator masih backlog operasional.

## Menyiapkan Microsoft Entra

1. Buka [Microsoft Entra admin center](https://entra.microsoft.com/), pilih tenant Zekivo, lalu **Entra ID → App registrations → New registration**. Untuk pengujian sekarang gunakan nama `Zekivo PG Devnet`, dan **Accounts in this organizational directory only** (single-tenant).
2. Pilih platform **Web**, isi redirect Devnet `http://localhost:13100/api/admin/auth/callback`, lalu Register. Pilihan origin per instance:
   - Lokal: `http://localhost:3100/api/admin/auth/callback`.
   - Devnet loopback: `http://localhost:13100/api/admin/auth/callback`.
   - Staging hosted: `https://<domain>/api/admin/auth/callback`.
     Gunakan App Registration terpisah untuk localnet/Devnet/staging hosted. Jangan mendaftarkan beberapa URI localhost dengan path sama yang hanya berbeda port dalam satu registration: Entra memperlakukan port loopback secara khusus. Panduan: [redirect URI Microsoft](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri).

3. Buka **Certificates & secrets → Client secrets → New client secret**. Salin **Value**, bukan Secret ID, saat ditampilkan. Buat credential client untuk backend. Simpan secret hanya dalam environment
   privat API/secret store; jangan kirim secret melalui chat, browser atau commit.
4. Catat Directory tenant ID, Application client ID dan **user object ID di tenant
   tujuan** untuk operator yang diizinkan. Ambil tenant/client ID di Overview App Registration; ambil object ID pengguna dari **Entra ID → Users → All users → akun operator → Overview**. Object ID pengguna berbeda dari Object ID App Registration. Object ID bukan email/client ID.
5. Terapkan assignment pengguna dan Conditional Access/MFA melalui Entra sesuai
   akses tenant/lisensi yang tersedia. Tombol login sendiri bukan bukti MFA aktif.
   Verifikasi kebijakan pada sign-in log sebelum menutup F7-01.
6. Isi environment privat (`.env` lokal atau `.env.devnet` khusus Devnet):

```dotenv
ADMIN_AUTH_ENABLED=true
ENTRA_TENANT_ID=<tenant-uuid>
ENTRA_CLIENT_ID=<application-client-uuid>
ENTRA_CLIENT_SECRET=<secret-backend>
ADMIN_ALLOWED_IDENTITIES={"<user-object-uuid>":"admin"}
```

Gunakan beberapa entri untuk operator/read-only. Config enabled dengan kredensial,
tenant, origin atau allowlist tidak valid ditolak saat startup. Environment flags
yang salah ketik juga ditolak. Ubah grant lewat konfigurasi dan restart API;
semua request berikutnya mengikuti allowlist baru. Tidak ada endpoint bootstrap
admin publik atau mock identity yang aktif di staging.

## Docker dan pemeriksaan

Migration `008_admin_sessions.sql` menambah tabel login request, session dan audit;
tidak mengubah invoice/ledger. Jalankan migration sebelum API baru jika mengaktifkan
auth; readiness memeriksa migration session ketika auth enabled. Compose hanya
meneruskan credential Entra ke service API, bukan frontend atau worker.
`pnpm local:up` / `pnpm devnet:up` sudah menjalankan urutan migration yang sesuai.

Buka `/login` pada origin yang sama dengan WEB_ORIGIN dan redirect terdaftar.
Jangan beralih antara localhost dan 127.0.0.1 saat login karena pemeriksaan Host/
Origin dan cookie sengaja ketat. Jika auth belum dikonfigurasi atau API tidak
tersedia, login ditutup dan halaman menjelaskan bahwa akses belum tersedia.

Tes backend menggunakan identity-provider stub yang hanya di-inject dari test,
bukan endpoint atau mode runtime. Tes memeriksa state sekali pakai, allowlist,
role, expiry, logout/CSRF, cookie Secure, serta isolasi environment/cluster.
Tes tersebut tidak membuktikan login, signature token issuer atau MFA Entra nyata.
Pengujian callback dengan tenant sebenarnya tetap wajib sebelum F7-01 selesai.

## Bukti implementasi — 17 Oktober 2026

126 tes pada 16 file lulus dengan PostgreSQL, termasuk enam tes session/OIDC
stub terisolasi dan tiga tes konfigurasi/permission. Typecheck, lint file terkait,
format dan build workspace lulus. Browser Chromium 390×844 dan 1440×1000:
login tertutup tanpa config, tanpa overflow horizontal atau pelanggaran axe
WCAG A/AA/2.1 AA; dashboard tanpa session redirect ke login. Screenshot Devnet
aktual: [login mobile](qa/admin-login-mobile.png).

Migration 008 sudah diterapkan ke database localnet dan Devnet; API/web keduanya
diperbarui. Smoke Devnet mengonfirmasi session proxy 503 ketika disabled,
no-store, frame denial dan redirect dashboard ke login. Credential Entra belum
tersedia, sehingga belum ada session operator dari Microsoft yang dibuat.
Config Compose terurai sudah diperiksa: key credential Entra hanya pada API,
tidak pada worker/web/provision/migrate. Provision dua aset tetap berhasil
setelah env job dibatasi, mempertahankan checkpoint yang sudah ada.

### Aktivasi konfigurasi Devnet dan perbaikan form login

Konfigurasi operator sekarang lolos validasi: satu identitas admin, origin
localhost:13100, tenant/client UUID dan discovery Entra berhasil. API Devnet
sudah direstart dengan konfigurasi tersebut. Readiness 200; session anonim 401
dan POST login same-origin menghasilkan 303 ke Microsoft dengan PKCE S256.
Ini belum membuktikan client secret atau login pengguna: validasi tersebut baru
selesai setelah code exchange dan pemeriksaan identitas pada callback.

Tes tombol browser menemukan Referrer-Policy no-referrer membuat navigasi form
POST mengirim Origin null. Login kini memakai same-origin agar pemeriksaan
Origin tetap ketat; callback dan endpoint autentikasi tetap no-referrer. Tes
browser regresi ada di admin-auth.spec.ts (ADMIN_AUTH_E2E=1 pada instance dengan
login enabled), mengintersep POST tanpa mengirim login ke Microsoft.

Hasil setelah perbaikan: ketiga test browser regresi lulus. Klik tombol asli
mengirim Origin http://localhost:13100, menuju login.microsoftonline.com dan
menampilkan input login Microsoft tanpa kode error AADSTS. Belum memasukkan
credential pengguna; callback dan session hasil login Microsoft tetap menunggu
operator. Halaman Devnet sudah diperbarui; source yang sama berlaku saat localnet
berikutnya dibangun ulang.

## Fresh authentication untuk pengelolaan project/key

Migration 009 menambah authenticated_at yang diisi dari auth_time ID token
terverifikasi. Login sekarang meminta prompt=login/max_age=0; maxAge library
memastikan timestamp autentikasi issuer valid. Mutasi project/key hanya admin
dengan auth_time dalam 10 menit terakhir, Origin dan CSRF sah. Session lama
tidak diberi timestamp autentikasi baru secara artifisial; dashboard baca tetap
berfungsi, lalu `/login?reauth=1` membuka login walaupun session masih aktif.
Fresh auth bukan pengganti Conditional Access/MFA. Flow issuer baru tetap perlu
diverifikasi operator saat mengaktifkan aksi tulis. Detail di PROJECTS-API-KEYS.md.

Refund manual: permission `refund:write` hanya diberikan kepada role admin.
Operator/read-only dapat membaca riwayat melalui `dashboard:read`. Pencatatan
memakai fresh auth/CSRF/Origin dan audit actor yang sama. Detail: [REFUNDS.md](REFUNDS.md).
