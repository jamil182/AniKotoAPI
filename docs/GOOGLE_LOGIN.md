# Login dan register dengan Google

Kedua halaman akun menggunakan OAuth authorization code, PKCE S256, state yang
terikat cookie browser, dan nonce. Server memverifikasi signature, issuer,
audience, masa berlaku, serta email terverifikasi melalui pustaka resmi Google.
Google hanya diminta akses `openid email profile`. Access token dan refresh token
Google tidak disimpan; website memakai sesi lokal HttpOnly selama tujuh hari.

## Konfigurasi aaPanel

Gunakan OAuth Client **Web application** milik Anda. Pada daftar **Authorized
redirect URIs** di Google Cloud, tambahkan tepat:

```text
https://aniyear.com/api/auth/google/callback
```

Isi tiga variabel ini pada `/www/wwwroot/anikoto-app/.env` melalui editor aaPanel:

```dotenv
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://aniyear.com/api/auth/google/callback
```

Masukkan Client ID dan Client Secret pada dua nilai yang kosong. Simpan rahasia
hanya di server, lalu restart proyek Node.js **anijs**. Jangan commit `.env`.
Jika aplikasi OAuth masih dalam mode pengujian, akun yang mengujinya harus
diizinkan sebagai test user. Untuk akses umum, sesuaikan audience/publishing
aplikasi di Google Cloud.

`GET /api/auth/google/status` harus mengembalikan `enabled: true` pada domain
yang sesuai dengan callback. Respons ini tidak menampilkan Client ID/Secret.
Konfigurasi tidak lengkap membuat tombol Google nonaktif; login email tetap
tersedia. Setelah mengganti domain, ubah URI di Google Cloud dan `.env` agar
tetap sama persis. Pengembangan lokal boleh memakai HTTP pada localhost di
lingkungan non-production, dengan OAuth Client dan redirect lokal yang sesuai.

## Akun baru dan akun lama

- Login/Register → **Lanjutkan dengan Google** otomatis membuat akun pengguna
  jika identitas Google belum terdaftar.
- Pengguna lama login dengan email/kata sandi, klik namanya pada navigasi untuk
  membuka `/account`, lalu pilih **Hubungkan akun Google**.
- Penautan membutuhkan sesi lokal yang masih valid ketika Google kembali.
  Pembuatan tautan dan rotasi sesi berada dalam satu transaksi database.
- Identitas memakai `sub` Google, bukan email. Email yang sama tidak otomatis
  menggabungkan dua akun. Satu akun Google hanya dapat ditautkan ke satu akun
  website, dan satu akun website memiliki paling banyak satu tautan Google.
- Pengguna Google baru tidak diberi kata sandi buatan. Hak admin tetap memakai
  ADMIN_TOKEN dan terpisah dari akun pengguna.

## Endpoint

| Endpoint | Fungsi |
| --- | --- |
| `GET /api/auth/google/status` | Status konfigurasi dan tautan pengguna saat ini |
| `GET /api/auth/google/start?next=/home` | Mulai login; tujuan akhir dibatasi path lokal |
| `GET /api/auth/google/callback` | Callback Google, hanya sekali untuk state dan browser yang cocok |
| `POST /api/auth/google/link` | Mulai penautan dari sesi aktif, JSON `{}`, perlindungan same-origin |

Flow kedaluwarsa setelah 10 menit dan disimpan di SQLite agar tetap bekerja
setelah restart. Jumlah flow dan pertukaran token dibatasi; verifikasi kunci
Google memanfaatkan cache pustaka. Respons autentikasi memakai `no-store` dan
callback memakai `Referrer-Policy: no-referrer`.

Referensi: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect),
[verifikasi token di server](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token),
[pedoman tombol Google](https://developers.google.com/identity/branding-guidelines).
