# Deployment aaPanel

Konfigurasi untuk `anime.jsmovies.my.id`:

| Pengaturan | Nilai |
| --- | --- |
| Repository | `https://github.com/jamil182/AniKotoAPI.git` |
| Branch | `main` |
| Folder aplikasi | `/www/wwwroot/anikoto-app` |
| Runtime | Node.js 24 LTS |
| Startup file | `server.js` |
| Working directory | `/www/wwwroot/anikoto-app` |
| Run user | `www` |
| Instances | `1` |
| Bind address | `127.0.0.1` |
| Port | `4455` |
| Database | `/www/server/anijs-data/anikoto.db` |

## Persiapan

Pasang Node.js 24 dari Website → Node.js Project → Node version manager.
Gunakan versi ini untuk aplikasi ini; tidak perlu mengubah versi global atau
runtime website lain. Clone repository ke folder aplikasi dan jalankan
`npm ci --omit=dev` menggunakan binary npm milik versi Node yang dipilih.
Tidak ada proses build frontend.

Buat folder database dengan pemilik `www` dan izin direktori `700`. Buat
`.env` di folder aplikasi, dengan pemilik `www` dan izin `600`:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=4455
PUBLIC_CATALOG_MODE=live
ANIKOTO_API_BASE_URL=https://anikototvapi.vercel.app/api
ALLOWED_ORIGINS=https://anime.jsmovies.my.id
DATABASE_PATH=/www/server/anijs-data/anikoto.db
```

Untuk mengaktifkan pengelolaan anime, pemilik server menambahkan `ADMIN_TOKEN`
yang panjang dan acak ke `.env`, lalu restart aplikasi. Tanpa nilai ini, akses
admin tetap dinonaktifkan. Jangan mengunggah `.env` atau database ke GitHub.

## Proses aplikasi

Tambahkan Node.js/PM2 project bernama `anijs` dengan nilai pada tabel di atas.
Pilih startup file `server.js`, satu instance dan pengguna `www`. Aktifkan
startup saat reboot melalui pengelola proses aaPanel. Jangan menjalankan aplikasi
yang sama sekaligus melalui PM2 dan `npm start` di terminal.

## Domain dan reverse proxy

Gunakan website aaPanel untuk `anime.jsmovies.my.id` dengan sertifikat SSL yang
valid. Jika website sudah ada, pertahankan sertifikat dan ACME challenge serta
buat cadangan konfigurasi sebelum mengubah proxy. Arahkan semua path ke Node.js,
termasuk `/assets`, `/api`, `/anime` dan `/watch`.

Konfigurasi location yang sesuai di dalam server block domain:

```nginx
location ^~ / {
    proxy_pass http://127.0.0.1:4455;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 15s;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
    proxy_buffering off;
    proxy_cache off;
}
```

Gunakan satu location untuk path `/`; jangan menambahkan location duplikat.
Location ini menghindari aturan file statis/PHP menangkap request frontend.
ACME challenge harus tetap memiliki location yang lebih spesifik. Jangan membuka
port `4455` ke internet; browser mengakses HTTPS melalui Nginx pada port `443`.
Aplikasi hanya mempercayai proxy loopback untuk alamat IP pengunjung. Nginx harus
menimpa header forwarded, seperti contoh di atas.

Jika memakai Cloudflare, pastikan DNS domain menuju IP server dan pertahankan
validasi sertifikat origin (Full strict). Jangan mengaktifkan cache untuk API,
halaman akun atau respons dengan session cookie.

## Pemeriksaan dan pembaruan

Periksa `http://127.0.0.1:4455/api/health` dari server, kemudian kunjungi
`https://anime.jsmovies.my.id/home`. Periksa pencarian, halaman anime, Embed,
Direct dan halaman akun. `/api/catalog/status` harus melaporkan mode `live`.
Tampilan katalog dan ketersediaan video tetap bergantung pada API/provider.

Untuk memperbarui: catat commit lama, jalankan `git pull --ff-only origin main`,
`npm ci --omit=dev`, lalu restart hanya proses `anijs` dan ulangi pemeriksaan.
Gunakan binary Node/npm yang sama dengan proses aplikasi. Simpan database di
lokasi yang tetap dan lakukan backup sebelum pembaruan yang mengubah skema.
Untuk backup SQLite yang aktif, gunakan SQLite backup API atau hentikan aplikasi
sebelum menyalin database beserta WAL/SHM. Jangan menyalin hanya file `.db` ketika
masih ada transaksi yang aktif.
