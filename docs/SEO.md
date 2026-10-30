# SEO dan sitemap Aniyear

Konfigurasi `.env`:

```dotenv
SITE_URL=https://aniyear.com
SITE_NAME=Aniyear
```

Nilai `SITE_URL` adalah origin HTTPS yang tetap, bukan header Host dari request.
Ini mencegah canonical dan sitemap mengarah ke host yang diberikan pengunjung.

## Endpoint publik

- `/robots.txt`: petunjuk crawler dan lokasi sitemap. Aset serta API katalog
  tetap dapat dirayapi untuk rendering frontend.
- `/sitemap.xml`: sitemap index otomatis untuk seluruh halaman katalog.
- `/sitemap-pages.xml`: landing, home, browse, jadwal, privasi, dan ketentuan.
- `/sitemap-anime-N.xml`: URL detail anime dari halaman katalog N. Dalam mode
  managed, hanya anime Published yang dicantumkan; dalam mode live, sumbernya
  katalog latest-updated AniKotoAPI.

Sitemap dipecah per halaman API dan dimuat ketika diminta. Membuka index tidak
mengunduh ratusan halaman katalog sekaligus. Cache internal berlaku lima menit,
memiliki batas ukuran, deduplikasi request, serta batas request paralel. Anime
baru akan tercakup setelah cache diperbarui dan Google membaca sitemap kembali.
Tidak ada `lastmod` buatan atau tanggal yang selalu diganti dengan waktu sekarang.
Jika sumber gagal, sitemap terkait mengembalikan 503 dan Retry-After, bukan
memberikan sitemap kosong berstatus 200.

## Halaman yang dirayapi

Landing, home, dan browse mengirim tautan anime langsung dalam HTML. Detail anime
mengirim judul, sinopsis, fakta, dan tautan episode sebelum JavaScript berjalan,
untuk semua pengunjung. Frontend tetap memperbarui episode dan komentar secara
normal. Konten serta footer dari template HTML server tetap dipertahankan.

Head memuat judul/deskripsi unik, canonical, Open Graph, Twitter Card, dan JSON-LD
WebSite/Organization serta CreativeWorkSeries atau Movie dan breadcrumb pada
detail. Tidak ada rating ulasan atau data video buatan. Parameter tracking dan
filter komentar tidak menghasilkan canonical baru. Browse memiliki canonical
sesuai filter dan nomor halaman yang valid.

Halaman akun, login, register, admin, pemutar, API, docs, dan shell `.html`
mengirim `X-Robots-Tag: noindex, follow`. Sitemap berfokus pada detail anime
sebagai halaman katalog utama. Anime yang tidak ditemukan mengembalikan 404;
gangguan sumber mengembalikan 503, sehingga kerangka kosong tidak diindeks.

## Google Search Console

1. Tambahkan/verifikasi properti domain `aniyear.com` pada Search Console. Jika
   diminta, tambahkan TXT verifikasi yang diberikan Google melalui penyedia DNS.
2. Pada Sitemaps, submit `https://aniyear.com/sitemap.xml`.
3. Gunakan URL Inspection untuk memeriksa landing dan beberapa detail anime
   lalu Request indexing untuk URL penting.
4. Pantau laporan Page indexing, sitemap, dan Core Web Vitals. Jika properti
   domain lama sudah diverifikasi, gunakan Change of Address sesuai panduan
   Google sambil mempertahankan redirect 301 dan sertifikat domain lama.

Sitemap membantu penemuan URL; Google menentukan kapan dan apakah suatu halaman
dirayapi, diindeks, atau ditampilkan. Tidak ada jaminan langsung muncul atau
peringkat tertentu.

Referensi resmi:
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
