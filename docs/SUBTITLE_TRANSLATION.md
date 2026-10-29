# Terjemahan subtitle Indonesia pada Direct

Di pemutar Direct, buka Settings → CC → **Indonesian (auto-translate)**. Jika
server video menyediakan subtitle Indonesia asli, gunakan **Indonesian**; pilihan
otomatis tidak ditambahkan lagi. Terjemahan otomatis membutuhkan subtitle Inggris.

Pekerjaan terjemahan berjalan di server. Pemutar menampilkan progres, tetap dapat
memutar video dan menampilkan subtitle asli selama menunggu. Hasil lengkap disimpan
di SQLite untuk dipakai kembali. Gagal/kuota habis ditampilkan sebagai pesan, bukan
dipasang sebagai track kosong. Pergantian server, mode atau penonaktifan CC
membatalkan penantian di browser; pekerjaan server bersama tetap dapat selesai.

`GET /api/stream/sub-translate?url=...&to=id&from=en` mengembalikan HTTP 202 JSON
dengan progres dan `Retry-After` selama proses, lalu HTTP 200 WebVTT setelah siap.
Klien API lama harus memeriksa HTTP 202 dan melakukan polling. Maksimal dua pekerjaan
berjalan bersamaan, satu pekerjaan dibatasi 12 menit. Hanya URL CDN yang lolos
allowlist yang dapat diambil, maksimal berkas 2 MiB dan dokumen 200.000 karakter.
Metadata VTT dan timestamp dipertahankan; dokumen terjemahan sebagian tidak di-cache.

## LibreTranslate lokal

Deployment ini memakai image resmi `docker.io/libretranslate/libretranslate`
yang dipin berdasarkan digest, dengan model `en,id` saja. Container Podman bernama
`anijs-translator` memakai volume `anijs-translator-models` dan unit systemd
`anijs-translator.service`. Batasnya 1,5 CPU, RAM 1.800 MiB, satu worker. Layanan
hanya mendengarkan loopback pada port 5001, tanpa reverse proxy publik.

Konfigurasi aplikasi:

```dotenv
TRANSLATE_PROVIDER=libretranslate
LIBRETRANSLATE_URL=http://127.0.0.1:5001
LIBRETRANSLATE_TIMEOUT_MS=180000
```

Restart proses `anijs` setelah perubahan env. Jangan menghapus env atau token admin
yang sudah ada. Model/volume tetap diperlukan setelah container direstart. Restart
layanan dengan `systemctl restart anijs-translator`; periksa melalui
`systemctl status anijs-translator` dan `podman logs --tail 30 anijs-translator`.
Tes pasangan bahasa lewat `curl http://127.0.0.1:5001/languages` dari server.

Penerjemahan pertama dapat memerlukan beberapa menit pada CPU; penonton berikutnya
memakai cache. Ini terjemahan mesin, sehingga nama, konteks dan kualitas dialog
dapat berbeda dari subtitle resmi. Bila video tidak memiliki subtitle sumber,
penerjemah ini tidak melakukan transkripsi audio.

## Penyedia lain

DeepL/LibreTranslate eksternal tetap dapat dikonfigurasi melalui env. MyMemory
adalah fallback tanpa konfigurasi, dengan batas gratis yang biasanya tidak cukup
untuk satu episode penuh. Menambah email MyMemory menaikkan batas tetapi tidak
menghapus kuota. Gunakan penyedia sesuai kebutuhan dan kapasitas server.
