# Komentar pengguna

Bagian **COMMENTS** muncul setelah informasi anime pada halaman detail dan
pemutar. Pengunjung bisa membaca tanpa akun. Mengirim komentar, membalas,
memberi suka, dan memilih reaksi memerlukan sesi pengguna yang masih valid,
termasuk akun Google yang memakai sistem sesi lokal yang sama.

Komentar disimpan di SQLite aplikasi, bukan di AniKoto. Identitas penulis diambil
dari sesi server; email dan ID Google tidak ditampilkan. Tidak ada komentar atau
angka reaksi contoh yang dimasukkan pada production.

## Penggunaan

- Pada pemutar, filter awal mengikuti episode yang sedang ditonton. Halaman
  detail membuka Diskusi anime. Filter juga menyediakan semua episode.
  Pilihan episode dipertahankan melalui URL ketika login atau memuat ulang halaman.
- Jika semua episode dipilih, label di bawah editor menunjukkan episode tujuan
  komentar baru. Balasan selalu mengikuti episode komentar induknya.
- Format yang tersedia: `**bold**`, `_italic_`, `~~strike~~`, `> quote`, dan
  `||spoiler||`. Semua HTML pengguna ditampilkan sebagai teks biasa.
- Centang **Spoiler** untuk menyembunyikan seluruh isi komentar di balik tombol.
  Timestamp `[12:34]` dapat mengarahkan video Direct yang sudah dimuat pada
  episode yang sama. Tombol emoji tidak memerlukan layanan eksternal.
- Gunakan Ctrl/Command + Enter untuk mengirim. ID pengiriman unik menjaga agar
  pengulangan permintaan yang sama tidak membuat komentar ganda.
- Daftar diperbarui setiap 30 detik saat halaman terlihat. Teks yang sedang
  ditulis tidak diganti ketika daftar diperbarui.

## GIF dan pencarian gambar KLIPY

Setelah login, tombol film di kanan bawah editor membuka pencarian **GIFs**
dan **Images**. Images memakai katalog gambar/meme statis KLIPY, bukan pencarian
web umum. Popup menampilkan 24 hasil per halaman, pencarian setelah jeda 350 ms,
dan **Load more**. Pilih satu lampiran, tambahkan teks jika diperlukan, lalu
kirim. Lampiran juga didukung pada balasan dan mengikuti penanda Spoiler.
Tombol × pada pratinjau menghapus lampiran sebelum dikirim.

1. Buat akun dan Web App Key di [KLIPY Partner Panel](https://partner.klipy.com/api-keys).
   Daftarkan domain aplikasi `aniyear.com`. Gunakan integrasi tanpa iklan;
   versi ini tidak menampilkan format iklan KLIPY.
2. Isi `KLIPY_PUBLIC_API_KEY=...` di `.env` aplikasi, lalu restart proses `anijs`.
   Ini **Web App Key publik**, bukan Google Client Secret atau ADMIN_TOKEN.
   Key ini sengaja tersedia melalui `GET /api/comments/media-config` agar
   browser dapat menghubungi KLIPY secara langsung.
3. Muat ulang halaman, login, lalu cari misalnya `one piece`. Jika key belum
   diatur, popup menampilkan informasi bahwa pencarian belum aktif. Komentar
   teks dan emoji tetap dapat dipakai.

Key berstatus **Testing** dapat digunakan untuk pengujian, dengan batas 100
request API per jam. Setelah diuji, ajukan **Request Production** melalui menu
tiga titik pada key di Partner Panel.

Sesuai [persyaratan KLIPY](https://docs.klipy.com/integration-requirements),
request API dan gambar dilakukan langsung dari browser. Tidak ada proxy API,
cache media, atau salinan file di server. SQLite menyimpan referensi
`{provider:"klipy", kind:"gif"|"image", slug, title}` saja; browser mengambil
URL terkini melalui Items API saat menampilkan komentar. Semua URL wajib HTTPS
dan berasal dari domain media resmi KLIPY. Parameter URL provider dipertahankan.
HTML seperti `<img>` di teks komentar tetap di-escape.

Pencarian memakai `content_filter=high`, mempertahankan urutan provider, serta
menampilkan atribusi **Powered by KLIPY**. Atur pemblokiran kata/konten melalui
Partner Panel. Hasil dengan format yang tidak didukung menyebabkan pesan
kesalahan untuk keseluruhan respons, bukan dihilangkan dari daftar diam-diam.
Jika media dihapus provider atau layanan tidak tersedia, komentar tetap terbaca
dengan keterangan **Media unavailable**. Kuota dan ketersediaan mengikuti paket
KLIPY yang digunakan; integrasi ini tidak menjanjikan penggunaan tanpa batas.

## Batas dan moderasi

Maksimum 4.000 karakter per komentar, satu tingkat balasan, 20 komentar utama
per halaman, 3 cuplikan balasan per komentar, dan 20 balasan per halaman.
Pengguna dibatasi satu komentar per 10 detik, 5 per menit, dan 30 per jam.
Catatan komentar yang dihapus tetap diperhitungkan untuk mencegah bypass batas.
Penulisan juga dibatasi per IP yang diverifikasi melalui reverse proxy.

Satu pengguna memiliki satu reaksi anime; memilih reaksi lain mengganti reaksi
sebelumnya. Suka juga unik per pengguna dan komentar. Endpoint memakai status
tujuan, sehingga pengulangan permintaan tidak membalik reaksi secara tak sengaja.

Admin memiliki bagian **Moderasi komentar** pada `/admin`, dengan filter dan
pagination. Admin dapat menyembunyikan dan memulihkan komentar yang ia
sembunyikan. Komentar yang dihapus penulis tidak dipulihkan melalui admin.
Komentar induk yang dihapus tetap menjadi penanda bila masih memiliki balasan;
isi dan nama penulisnya tidak ditampilkan pada respons publik.

Semua endpoint penulisan memeriksa login dan same-origin di server. Moderasi
tetap memerlukan ADMIN_TOKEN; akun Google tidak mendapat hak admin. Respons
memakai `no-store` karena status suka dan tombol penulis berbeda untuk setiap
pengguna. Mode managed juga memeriksa status publikasi pada pembacaan dan
interaksi publik. Komentar memakai slug publik anime sebagai kunci diskusi.

## API

| Endpoint | Tujuan |
| --- | --- |
| `GET /api/comments?slug=...&episode=1&sort=newest&page=1` | Baca diskusi; episode `0` = umum, `all` = semua |
| `GET /api/comments/media-config` | Status fitur dan Web App Key publik KLIPY |
| `POST /api/comments` | Kirim `slug, episode, body, spoiler, parentId, requestId`, opsional `media` |
| `GET /api/comments/:id/replies?page=1` | Balasan dengan pagination |
| `PUT /api/comments/:id/like` | JSON `{ "liked": true }` atau false |
| `PUT /api/comments/reaction` | JSON `{ "slug": "...", "mood": "peak" }`; null menghapus reaksi |
| `DELETE /api/comments/:id` | Sembunyikan komentar milik sendiri, JSON `{}` |
| `GET /api/admin/comments?state=visible&page=1` | Daftar moderasi; filter visible/hidden/all |
| `PATCH /api/admin/comments/:id` | JSON `{ "hidden": true }` atau false |

Migrasi menambahkan tabel, indeks, dan kolom `media_json` tanpa mengubah identitas
komentar lama. Lampiran tanpa teks memakai satu spasi internal untuk kompatibilitas
dengan batas skema lama; respons API tetap mengembalikan caption kosong.
Tetap cadangkan database dengan
SQLite backup API sebelum deployment, dan pertahankan `.env` serta aset merek
yang sudah disesuaikan pada server.
