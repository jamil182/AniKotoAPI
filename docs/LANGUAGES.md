# English / Bahasa Indonesia

Pilihan EN dan ID tersedia pada navigasi publik. Pengunjung baru menggunakan EN,
terlepas dari bahasa browser. Pilihan disimpan di localStorage dan dipakai kembali
saat berpindah halaman. Jika storage diblokir, tombol tetap bekerja pada halaman
yang sedang dibuka.

Label menu, kontrol, dan metadata umum memakai kamus lokal. Pembaruan konten
melalui polling tetap mengikuti pilihan bahasa. Judul anime, nama pengguna,
komentar, input form, kode, dan kontrol pemutar pihak ketiga tidak diterjemahkan.
Pengaturan ini tidak mengubah pilihan audio atau subtitle video.

Sinopsis utama, slideshow, jadwal, dan hover card diterjemahkan ketika terlihat
dalam mode ID. Endpoint `/api/catalog/synopsis/:slug?lang=id` hanya menerima slug
katalog dan mengambil teks publiknya dari server. Browser tidak mengirim komentar
atau teks bebas untuk diterjemahkan. Penyedia mengikuti konfigurasi terjemahan
subtitle yang sudah ada; produksi menggunakan LibreTranslate lokal.

Hasil disimpan di tabel SQLite `synopsis_translations`, berdasarkan hash konten
dan penyedia. Maksimal 2.000 hasil disimpan. Pekerjaan berlangsung di latar belakang,
dua pekerjaan sekaligus, dengan polling 202. Kegagalan ditampilkan sebagai pesan
dan sinopsis asli tetap tersedia. Memilih ID kembali akan mencoba ulang.

SEO dan canonical tetap memakai konten EN dari server; pergantian bahasa ini
merupakan preferensi antarmuka, bukan versi URL terpisah dengan hreflang.

Browse mengisi baris poster yang belum penuh memakai anime berbeda dari halaman
berikutnya, atau halaman sebelumnya pada halaman terakhir. Kartu tambahan adalah
pratinjau; jumlah halaman asli dipertahankan dan tidak ada judul atau jumlah
episode buatan. Baris yang sudah penuh dan katalog kosong tidak ditambahi kartu.
