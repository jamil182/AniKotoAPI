# Statistik pengunjung di admin

Buka `/admin` dan masuk dengan token admin yang sudah ada. Statistik diperbarui
setiap 15 detik saat tab admin terlihat. Skrip kecil pada halaman publik mencatat
tampilan halaman dan mengirim heartbeat setiap 30 detik saat tab terlihat.
Halaman admin, login/register, API, aset, query string dan fragment tidak dicatat.

- **Online:** perkiraan pengunjung aktif dalam 90 detik terakhir, termasuk tamu.
- **Pengunjung hari ini:** IP + user agent berbeda dalam hari WIB berjalan.
- **Total kunjungan:** sesi aktivitas, dimulai kembali setelah jeda 30 menit.
- **Total tampilan halaman:** pemuatan halaman publik; retry dan heartbeat tidak menambah hit.
- **Counter harian:** pengunjung, kunjungan dan tampilan halaman untuk 7 hari terakhir.
- **IP dan lokasi:** 20 pengunjung per halaman, aktivitas terakhir, halaman dan status online.

Identitas statistik adalah HMAC IP + user agent dengan secret acak di SQLite,
terpisah dari akun pengguna. Tidak memakai cookie tracking. Orang dengan IP dan
browser sama dapat tergabung; IP/browser baru dapat dihitung terpisah. Ini bukan
alat audit atau counter anti-fraud; bot yang menyamar tetap dapat memengaruhi angka.

Migrasi tabel berjalan otomatis. Angka dimulai saat fitur aktif; tidak merekonstruksi
traffic lama. Database yang sama mempertahankan counter setelah restart. Detail
pengunjung dihapus setelah tidak aktif 30 hari; event deduplikasi dan identitas harian
sementara dihapus setelah 2 hari. Pembersihan berlangsung paling sering sekali per
jam saat endpoint statistik dikunjungi. Counter agregat tidak dihapus.

Lokasi kota/wilayah/negara diambil dari `https://ipwho.is` di server, tanpa API key.
Hanya IP publik yang dikirim; hasil di-cache 24 jam, kegagalan 5 menit. Maksimal dua
lookup bersamaan dan 900 lookup/hari UTC per proses; HTTP 429 menghentikan lookup
selama 24 jam. Angka kunjungan tetap bekerja bila layanan lokasi gagal. Lokasi VPN
atau seluler bisa berbeda dari lokasi fisik. Matikan lookup eksternal dengan:

```dotenv
VISITOR_GEO_LOOKUP=false
```

Restart aplikasi setelah mengubah env. Lokasi lama yang sudah tersimpan tetap ada
sampai masa cache berakhir atau detail pengunjung dibersihkan. Kebijakan privasi
publik menjelaskan data dan layanan lokasi tersebut.

## Reverse proxy dan keamanan

`GET /api/admin/visitors?page=1` dilindungi `ADMIN_TOKEN`; respons berisi IP memakai
`Cache-Control: no-store` dan `CDN-Cache-Control: no-store`. `POST /api/visit` hanya
menerima path publik dan UUID halaman, memeriksa origin, menolak bot yang dikenal,
serta memakai rate limiter aplikasi. Statistik dikirim dengan DOM `textContent`,
sehingga path atau lokasi tidak dirender sebagai HTML.

Server mempercayai proxy loopback saja. Nginx harus menimpa `X-Forwarded-For`
dengan `$remote_addr` (lihat panduan aaPanel), bukan mempercayai header klien.
`CF-Connecting-IP` hanya diterima bila hop upstream yang diverifikasi berada dalam
rentang resmi Cloudflare. Daftar subnet di `src/services/visitorAddress.js` mengikuti
`https://www.cloudflare.com/ips-v4` dan `/ips-v6`, diverifikasi 2026-10-30; perbarui bila
Cloudflare mengubah daftar. Tidak mempercayai header Cloudflare dari koneksi langsung.

Satu SQLite writer cocok untuk deployment satu instance aaPanel. Untuk beberapa
server, diperlukan penyimpanan dan kuota geolokasi bersama. Browser yang memblokir
JavaScript/statistik tidak terhitung. Batasi akses admin dan lindungi backup database.
