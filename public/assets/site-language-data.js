const pairs = [
  ['Home','Beranda'],['Weekly Schedule','Jadwal Mingguan'],['Estimated Schedule','Perkiraan Jadwal'],['Random','Acak'],
  ['Login','Masuk'],['Register','Daftar'],['Logout','Keluar'],['Search anime…','Cari anime…'],['Search anime','Cari anime'],
  ['Latest Episodes','Episode Terbaru'],['Most Popular','Terpopuler'],['Top Anime','Anime Teratas'],['Genres','Genre'],['Genre','Genre'],
  ['All','Semua'],['Trending','Tren'],['View more →','Lihat semua →'],['All Anime','Semua Anime'],['Trending Anime','Anime Tren'],
  ['Most Popular Anime','Anime Terpopuler'],['Newly Added Anime','Anime Baru Ditambahkan'],['Upcoming Anime','Anime Mendatang'],
  ['Ongoing Anime','Anime Tayang'],['Completed Anime','Anime Selesai'],['Latest','Terbaru'],['Updated','Diperbarui'],['Added','Ditambahkan'],
  ['Popular','Populer'],['Upcoming','Mendatang'],['Ongoing','Sedang Tayang'],['Completed','Selesai'],['Types','Jenis'],['Type','Jenis'],
  ['TV Series','Serial TV'],['Movies','Film'],['Movie','Film'],['Special','Spesial'],['Specials','Spesial'],
  ['Day','Hari'],['Week','Minggu'],['Month','Bulan'],['A-Z List','Daftar A-Z'],['Episodes','Episode'],
  ['▶ Details','▶ Detail'],['▶ Watch','▶ Tonton'],['▶ Watch now','▶ Tonton sekarang'],['Full details →','Detail lengkap →'],
  ['Previous page','Halaman sebelumnya'],['Next page','Halaman berikutnya'],['‹ Previous','‹ Sebelumnya'],['Next ›','Berikutnya ›'],
  ['Previous week','Minggu sebelumnya'],['Next week','Minggu berikutnya'],['← Home','← Beranda'],['Retry','Coba lagi'],
  ['Loading…','Memuat…'],['Connecting…','Menghubungkan…'],['No anime found.','Anime tidak ditemukan.'],['No synopsis available.','Sinopsis belum tersedia.'],
  ['No episodes listed.','Belum ada episode.'],['Other names','Nama lain'],['Scores','Skor'],['Year','Tahun'],['Duration','Durasi'],
  ['Status','Status'],['Premiered','Tayang perdana'],['Aired','Tanggal tayang'],['Studios','Studio'],['Producers','Produser'],
  ['Currently Airing','Sedang Tayang'],['Finished Airing','Selesai Tayang'],['Not yet aired','Belum Tayang'],['Catalog score','Skor katalog'],
  ['Score from the anime catalog','Skor dari katalog anime'],['[more]','[selengkapnya]'],['[less]','[ringkas]'],
  ['Action','Aksi'],['Adventure','Petualangan'],['Comedy','Komedi'],['Drama','Drama'],['Fantasy','Fantasi'],['Romance','Romansa'],
  ['Horror','Horor'],['Mystery','Misteri'],['Sports','Olahraga'],['Music','Musik'],['Slice of Life','Kehidupan Sehari-hari'],
  ['Please bookmark','Silakan bookmark'],['to stay updated. Thank you!','untuk mengikuti kabar terbaru. Terima kasih!'],
  ['Close bookmark reminder','Tutup pengingat bookmark'],['Open menu','Buka menu'],['Close menu','Tutup menu'],
  ['Privacy Policy','Kebijakan Privasi'],['Terms of Service','Syarat Layanan'],['Watch','Tonton'],['Watch now','Tonton sekarang'],
  ['Embed servers','Server embed'],['Direct','Langsung'],['Light','Lampu'],['Auto Play','Putar Otomatis'],['Auto Next','Episode Berikut Otomatis'],
  ['Auto Skip','Lewati Otomatis'],['Use the embedded player\'s controls for subtitles and quality.','Gunakan kontrol pemutar embed untuk subtitle dan kualitas.'],
  ['Direct mode uses the built-in video controls.','Mode langsung menggunakan kontrol video bawaan.'],
  ['If a server doesn\'t work, try another.','Jika server tidak bekerja, coba server lain.'],
  ['Comments','Komentar'],['Note:','Catatan:'],['Sort by','Urutkan'],['Newest','Terbaru'],['Oldest','Terlama'],['Most liked','Paling disukai'],
  ['Leave a comment','Tulis komentar'],['Post comment','Kirim komentar'],['Reply','Balas'],['Delete','Hapus'],['Preview','Pratinjau'],
  ['Anime discussion','Diskusi anime'],['Comment deleted.','Komentar telah dihapus.'],['View spoiler comment','Lihat komentar spoiler'],
  ['No comments yet. Be the first to share your thoughts.','Belum ada komentar. Jadilah yang pertama berbagi pendapat.'],
  ['Read the','Luangkan waktu membaca'],['comment rules','aturan komentar'],['before posting.','sebelum mengirim.'],
  ['Comment rules','Aturan komentar'],['Close','Tutup'],['Loading comments…','Memuat komentar…'],
  ['Sign in to react','Login untuk memberi reaksi'],['All episodes','Semua episode'],['Cancel','Batal'],
  ['Respect others. Avoid insults, threats, and hate speech.','Hormati pengguna lain. Hindari hinaan, ancaman, dan ujaran kebencian.'],
  ['Do not post spam, promotions, or personal information.','Jangan mengirim spam, promosi, atau informasi pribadi.'],
  ['Mark spoilers for storylines others have not watched.','Gunakan penanda Spoiler untuk alur cerita yang belum ditonton orang lain.'],
  ['Discuss the correct anime and episode. Admins may hide comments that break the rules.','Bahas anime dan episode yang sesuai. Admin dapat menyembunyikan komentar yang melanggar.'],
  ['You are signed in and can post a comment.','Anda sudah login dan dapat mengirim komentar.'],
  ['Continue with Google','Lanjutkan dengan Google'],['or with email','atau dengan email'],['Password','Kata sandi'],
  ['Welcome back','Selamat datang kembali'],['Sign in with your Google account or email.','Masuk menggunakan akun Google atau email Anda.'],
  ['Create an account','Buat akun'],['Display name','Nama tampilan'],['Confirm password','Konfirmasi kata sandi'],
  ['← Back to home','← Kembali ke beranda'],['Already have an account?','Sudah punya akun?'],['Don\'t have an account?','Belum punya akun?'],
  ['Account settings','Pengaturan akun'],['Your account','Akun Anda'],['Link Google','Hubungkan Google'],['Google connected','Google terhubung'],
  ['All posts, ordered by the latest episode updates.','Semua postingan, diurutkan berdasarkan pembaruan episode terbaru.'],
  ['Browse anime by type.','Jelajahi anime menurut jenisnya.'],['Discover the titles trending now.','Temukan anime yang sedang tren.'],
  ['Browse the most popular anime.','Jelajahi anime terpopuler.'],['The newest additions to the catalog.','Anime yang baru ditambahkan ke katalog.'],
  ['Discover anime that have not aired yet.','Temukan anime yang belum tayang.'],['Anime that are currently airing.','Anime yang sedang tayang.'],
  ['Browse anime that have finished airing.','Jelajahi anime yang telah selesai tayang.'],
  ['Explore the latest anime','Jelajahi anime terbaru'],['Visit Home →','Buka Beranda →'],['Real-Time Anime','Anime Terkini'],
  ['Your anime catalog, always updating','Katalog anime yang selalu diperbarui'],['How it works','Cara kerjanya'],['What is inside','Fitur yang tersedia'],
  ['Nothing here yet.','Belum ada konten.'],['No matches.','Tidak ada hasil.'],['Released','Sudah tayang'],['Time TBA','Waktu belum tersedia'],
];
const entries = new Map();
for (const pair of pairs) for (const phrase of pair) if (!entries.has(phrase.toLowerCase())) entries.set(phrase.toLowerCase(), pair);

/** @param {unknown} value @returns {'en' | 'id'} */
export const siteLocale = value => value === 'id' ? 'id' : 'en';

/** Translate known interface labels only. User content and anime titles are excluded by the caller.
 * @param {string} value @param {'en' | 'id'} locale */
export function languageLabel(value, locale) {
  const trimmed=value.trim().replace(/\s+/g,' '), pair=entries.get(trimmed.toLowerCase());
  let text=pair?.[locale==='id' ? 1 : 0];
  const page=/^(?:Page|Halaman) (\d+) (?:of|dari) (\d+)$/i.exec(trimmed);
  if (page) text=locale==='id' ? `Halaman ${page[1]} dari ${page[2]}` : `Page ${page[1]} of ${page[2]}`;
  const count=/^(\d+) (?:Comments|Komentar)$/i.exec(trimmed);
  if (count) text=count[1]+(locale==='id' ? ' Komentar' : ' Comments');
  const reviews=/^(\S+) (?:reviews|ulasan)$/i.exec(trimmed);
  if (reviews) text=reviews[1]+(locale==='id' ? ' ulasan' : ' reviews');
  if (!text) return value;
  if (trimmed.toUpperCase()===trimmed && /[A-Z]{2}/.test(trimmed)) text=text.toUpperCase();
  return value.match(/^\s*/)[0]+text+value.match(/\s*$/)[0];
}
