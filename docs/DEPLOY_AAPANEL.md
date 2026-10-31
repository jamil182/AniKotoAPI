# Deployment aaPanel

Konfigurasi untuk `aniyear.com`:

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
ANIKOTO_API_BASE_URL=https://aniyear.com/api
ALLOWED_ORIGINS=https://aniyear.com
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

Gunakan website aaPanel untuk `aniyear.com` dengan sertifikat SSL yang
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

Panel `/admin` juga menampilkan statistik pengunjung: IP/lokasi, jumlah online,
counter kunjungan dan tampilan halaman. Migrasi SQLite berjalan otomatis; backup
database sebelum update. Statistik dimulai saat fitur dipasang. Pengaturan lokasi,
retensi dan batasan counter dijelaskan di [Statistik pengunjung](VISITOR_STATS.md).

Periksa `http://127.0.0.1:4455/api/health` dari server, kemudian kunjungi
`https://aniyear.com/home`. Periksa pencarian, halaman anime, Embed,
Direct dan halaman akun. `/api/catalog/status` harus melaporkan mode `live`.
Tampilan katalog dan ketersediaan video tetap bergantung pada API/provider.

Pembatas permintaan memisahkan playback (default `PLAYBACK_RATE_LIMIT=300` per IP),
katalog/akun (default `RATE_LIMIT=100` per IP), dan API native publik. Jendelanya
`RATE_WINDOW=60000` milidetik. Pindah episode tidak menghabiskan jatah Home.
Potongan video, subtitle asli, dan health tidak memakai jatah ini; batas khusus
login, komentar, dan terjemahan tetap berlaku. Respons 429 menyertakan `Retry-After`
dan `Cache-Control: no-store`, sehingga browser dapat menunggu tanpa menyimpan error.

Saat `ANIKOTO_API_BASE_URL` menunjuk tepat ke `/api` pada origin HTTPS `SITE_URL`,
client menandai panggilan native dari proses aplikasi sendiri dengan marker acak
yang hanya hidup di memori proses. Hanya panggilan GET native dengan marker valid
yang dikecualikan, agar seluruh pengunjung tidak berbagi jatah IP keluar server.
Marker tidak dikirim ke provider lain dan tidak menggantikan autentikasi akun/admin.
Tidak perlu menambah credential di `.env`. Provider video tetap dapat membatasi
permintaan di sisi mereka; perbaikan ini mengatasi pembatas internal aplikasi.

Untuk memperbarui: catat commit lama, jalankan `git pull --ff-only origin main`,
`npm ci --omit=dev`, lalu restart hanya proses `anijs` dan ulangi pemeriksaan.
Gunakan binary Node/npm yang sama dengan proses aplikasi. Simpan database di
lokasi yang tetap dan lakukan backup sebelum pembaruan yang mengubah skema.
Untuk backup SQLite yang aktif, gunakan SQLite backup API atau hentikan aplikasi
sebelum menyalin database beserta WAL/SHM. Jangan menyalin hanya file `.db` ketika
masih ada transaksi yang aktif.

## Migrasi domain ke aniyear.com

Sumber katalog production memakai `ANIKOTO_API_BASE_URL=https://aniyear.com/api`.
Endpoint `/api/latest-updated`, `/api/info`, dan `/api/watch` adalah API native
aplikasi, sehingga katalog tidak bergantung pada deployment Vercel pihak ketiga.
Jangan memakai `/api/catalog` sebagai base URL karena akan membuat request berulang
ke adapter yang sama. Jika domain berubah, perbarui base URL ini ke origin baru
dan periksa respons JSON sebelum restart. Simpan base URL HTTPS dengan sertifikat valid.

Jika muncul `Catalog temporarily unavailable`, periksa `/api/health` dan
`/api/catalog/browse?page=1`. Health 200 dengan browse 502 menunjukkan kegagalan
sumber katalog; periksa sumber tersebut sebelum mengubah database atau DNS.

Domain utama adalah `https://aniyear.com`. Aplikasi tetap menggunakan folder,
proses `anijs`, port, dan database yang sama; akun, komentar, serta katalog tidak
perlu diimpor ulang. Cookie sesi dibatasi per domain sehingga pengguna perlu
login kembali saat pertama membuka domain baru.

Website aaPanel `aniyear.com` meneruskan request ke `127.0.0.1:4455` melalui
`/www/server/panel/vhost/nginx/proxy/aniyear.com/anijs.conf`. HTTP dialihkan ke
HTTPS. Pertahankan lokasi ACME yang lebih spesifik untuk pembaruan sertifikat.
Website lama `anime.jsmovies.my.id` memberikan redirect permanen 301 ke
`https://aniyear.com$request_uri`, sehingga path episode dan query tetap utuh.
Pertahankan DNS serta sertifikat domain lama agar redirect HTTPS tetap bekerja.

Callback di `.env` dan Authorized redirect URIs di Google Cloud harus sama:
`https://aniyear.com/api/auth/google/callback`. Restart hanya `anijs` setelah
mengubah environment. Jangan mengganti Client ID, Client Secret, ADMIN_TOKEN,
atau lokasi database hanya karena mengganti domain.

Konfigurasi sebelum migrasi dicadangkan di `/www/backup/anijs-domain/` pada
server. Cadangan `.env` bersifat rahasia dan tidak boleh dipublikasikan.
