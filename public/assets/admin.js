import { createAdminClient } from './admin-client.js';

const client = createAdminClient();
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const tokenKey = 'anijs_admin_token';
let rows = [], page = 1, editing = null, searchVersion = 0;
let searchKeyword = '';
const PAGE_SIZE = 12;

async function showCatalogMode() {
  try {
    const response = await fetch('/api/catalog/status', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Catalog status unavailable');
    const data = await response.json();
    if (!data.success || !['live', 'managed'].includes(data.results?.mode)) throw new Error('Invalid catalog status');
    $('catalogModeInfo').textContent = data.results.mode === 'live'
      ? 'Mode otomatis: anime dan episode baru tampil langsung dari AniKotoAPI tanpa impor admin. Koleksi manual di bawah tidak membatasi beranda.'
      : 'Mode manual: impor sebagai Draft, tinjau datanya, lalu Publish. Hanya anime Published yang tampil di website.';
  } catch {
    $('catalogModeInfo').textContent = 'Sumber katalog publik belum dapat diperiksa. Muat ulang halaman untuk mencoba lagi.';
  }
}
showCatalogMode();

function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').hidden = false;
  $('notice').classList.toggle('error', error);
}
function signedOut() {
  client.setToken('');
  $('workspace').hidden = true;
  $('authPanel').hidden = false;
  $('runSync').hidden = true;
  $('logout').hidden = true;
  $('editor').close();
  try { sessionStorage.removeItem(tokenKey); localStorage.removeItem(tokenKey); } catch { /* Storage can be disabled. */ }
}
async function action(button, work) {
  const disabled = button.disabled;
  button.disabled = true;
  try { await work(); }
  catch (error) {
    notice(error.message, true);
    $('editError').textContent = error.message;
    if (error.status === 401 || error.status === 503) { signedOut(); $('authError').textContent = error.message; }
  } finally { button.disabled = disabled; }
}
async function connect(token) {
  client.setToken(token);
  await loadLibrary();
  $('authPanel').hidden = true;
  $('workspace').hidden = false;
  $('runSync').hidden = false;
  $('logout').hidden = false;
  $('authError').textContent = '';
  $('token').value = '';
  try { sessionStorage.setItem(tokenKey, token); localStorage.removeItem(tokenKey); } catch { /* Session remains usable without storage. */ }
}
$('loginForm').onsubmit = event => {
  event.preventDefault();
  action(event.submitter, () => connect($('token').value.trim()));
};
$('logout').onclick = signedOut;

async function loadLibrary() {
  rows = await client.request('/library');
  if (!Array.isArray(rows)) throw new Error('Respons koleksi tidak valid.');
  $('countAll').textContent = rows.length;
  $('countPublished').textContent = rows.filter(row => row.publication_state === 'published').length;
  $('countDraft').textContent = rows.filter(row => row.publication_state !== 'published').length;
  $('countAuto').textContent = rows.filter(row => row.auto_update).length;
  renderLibrary();
}
function renderLibrary() {
  const keyword = $('librarySearch').value.trim().toLowerCase();
  const state = $('publicationFilter').value;
  const filtered = rows.filter(row => (!keyword || `${row.title} ${row.public_slug}`.toLowerCase().includes(keyword)) && (state === 'all' || row.publication_state === state));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  page = Math.min(page, pages);
  $('pageLabel').textContent = `${filtered.length} anime · Halaman ${page} / ${pages}`;
  $('prevPage').disabled = page <= 1;
  $('nextPage').disabled = page >= pages;
  $('libraryRows').innerHTML = filtered.length ? filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(row => {
    const published = row.publication_state === 'published';
    return `<article class="cms-row"><img src="${esc(row.poster || '/favicon.svg')}" alt="" loading="lazy"><div class="cms-row-info"><h3>${esc(row.title)}</h3><div class="cms-row-meta"><span class="cms-badge ${published ? 'published' : ''}">${published ? 'Published' : 'Draft'}</span><span>${row.episode_count} episode</span>${row.auto_update ? '<span>Sinkron otomatis</span>' : ''}</div><p>${esc(row.public_slug)}</p></div><div class="cms-row-actions"><button class="btn" data-edit="${row.id}">Edit</button><button class="btn ${published ? '' : 'primary'}" data-publish="${row.id}">${published ? 'Jadikan Draft' : 'Publish'}</button><button class="btn" data-sync="${row.id}" ${row.source_slug || row.anikoto_id ? '' : 'disabled'}>Sinkron</button>${published ? `<a class="btn" href="/anime/${encodeURIComponent(row.public_slug)}" target="_blank" rel="noopener">Lihat ↗</a>` : `<button class="btn cms-delete" data-delete="${row.id}">Hapus</button>`}</div></article>`;
  }).join('') : `<div class="cms-empty"><h3>${rows.length ? 'Tidak ada hasil yang cocok' : 'Koleksi masih kosong'}</h3><p>${rows.length ? 'Coba kata kunci atau status lain.' : 'Cari anime di atas, impor sebagai Draft, lalu Publish untuk menampilkannya di website.'}</p></div>`;
}
$('librarySearch').oninput = () => { page = 1; renderLibrary(); };
$('publicationFilter').onchange = () => { page = 1; renderLibrary(); };
$('prevPage').onclick = () => { page--; renderLibrary(); };
$('nextPage').onclick = () => { page++; renderLibrary(); };
$('reloadLibrary').onclick = event => action(event.currentTarget, loadLibrary);
$('libraryRows').onclick = event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.dataset.edit) { openEditor(Number(button.dataset.edit)); return; }
  action(button, async () => {
    if (button.dataset.publish) {
      const row = rows.find(item => item.id === Number(button.dataset.publish));
      const state = row.publication_state === 'published' ? 'draft' : 'published';
      await client.request('/anime/' + row.id, { method: 'PATCH', body: { publication_state: state } });
      notice(state === 'published' ? `${row.title} telah dipublikasikan.` : `${row.title} disimpan sebagai Draft dan disembunyikan dari website.`);
    } else if (button.dataset.sync) {
      const result = await client.request('/anime/' + button.dataset.sync + '/sync', { method: 'POST' });
      notice(`Sinkron selesai: ${result.added} episode baru, total ${result.episodeCount} episode.`);
    } else if (button.dataset.delete) {
      const row = rows.find(item => item.id === Number(button.dataset.delete));
      if (!confirm(`Hapus Draft “${row.title}” beserta episode lokalnya?`)) return;
      await client.request('/anime/' + row.id, { method: 'DELETE' });
      notice('Draft berhasil dihapus.');
    }
    await loadLibrary();
  });
};

async function searchApi(button, requestedPage = 1) {
  const version = ++searchVersion;
  await action(button, async () => {
    $('searchResults').textContent = 'Mencari…';
    const result = await client.request('/search?keyword=' + encodeURIComponent(searchKeyword) + '&page=' + requestedPage);
    if (version !== searchVersion) return;
    const items = result.data;
    $('searchResults').innerHTML = items.length ? items.map(item => `<div class="admin-hit"><img src="${esc(item.poster || '/favicon.svg')}" alt=""><div><b>${esc(item.title)}</b><div class="admin-hit-m">${esc(item.type || 'Anime')} · ${esc(item.slug)}</div></div><button type="button" class="btn" data-select-slug="${esc(item.slug)}">Pilih</button></div>`).join('') : '<p>Tidak ada hasil.</p>';
    if (result.totalPages > 1) $('searchResults').insertAdjacentHTML('beforeend', `<div class="cms-pager">${requestedPage > 1 ? `<button class="btn" data-search-page="${requestedPage - 1}">‹</button>` : ''}<span>Hasil ${requestedPage} / ${result.totalPages}</span>${requestedPage < result.totalPages ? `<button class="btn" data-search-page="${requestedPage + 1}">›</button>` : ''}</div>`);
  });
}
$('searchForm').onsubmit = event => {
  event.preventDefault();
  searchKeyword = $('searchTitle').value.trim();
  searchApi(event.submitter);
};
$('searchResults').onclick = event => {
  const pager = event.target.closest('[data-search-page]');
  if (pager) { searchApi(pager, Number(pager.dataset.searchPage)); return; }
  const button = event.target.closest('[data-select-slug]');
  if (button) { $('importSlug').value = button.dataset.selectSlug; $('importSlug').focus(); }
};
$('importForm').onsubmit = event => {
  event.preventDefault();
  action(event.submitter, async () => {
    let slug = $('importSlug').value.trim();
    if (/^https?:\/\//.test(slug)) {
      const url = new URL(slug);
      const match = /^\/(?:watch|anime)\/([^/]+)/.exec(url.pathname);
      if (!match) throw new Error('URL harus berupa halaman anime atau watch AniKoto.');
      slug = match[1];
    }
    const result = await client.request('/import', { method: 'POST', body: { slug, sub: $('importSub').checked, dub: $('importDub').checked, autoUpdate: $('importAuto').checked } });
    await loadLibrary();
    notice(`${result.anime.title}: ${result.episodeCount} episode tersimpan. Status ${result.anime.publication_state === 'published' ? 'Published dipertahankan' : 'Draft'}.`);
    openEditor(result.animeId);
  });
};
$('malForm').onsubmit = event => {
  event.preventDefault();
  action(event.submitter, async () => {
    const result = await client.request('/fetch-mal', { method: 'POST', body: { source: $('malSource').value, id: $('malId').value.trim(), episode: $('malEpisode').value, sub: $('malSub').checked, dub: $('malDub').checked } });
    await loadLibrary();
    notice('Episode tersimpan. Tinjau data anime sebelum Publish.');
    openEditor(result.animeId);
  });
};
$('runSync').onclick = event => action(event.currentTarget, async () => {
  let result = await client.request('/sync-all', { method: 'POST' });
  while (result.running) {
    notice(`Sinkron berjalan: ${result.checked} / ${result.total} anime diperiksa, ${result.added} episode baru.`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    result = await client.request('/sync-status');
  }
  await loadLibrary();
  notice(`${result.checked} anime diperiksa, ${result.added} episode baru.${result.failures.length ? ' Gagal: ' + result.failures.map(item => item.title).join(', ') : ''}`, result.failures.length > 0);
});

function openEditor(id) {
  const row = rows.find(item => item.id === id);
  if (!row) return;
  editing = id;
  const fields = { editTitle: 'title', editSlug: 'public_slug', editJapanese: 'japanese_title', editPoster: 'poster', editBanner: 'banner', editSynopsis: 'synopsis', editType: 'type', editStatus: 'status', editRating: 'rating', editPublication: 'publication_state' };
  for (const [element, key] of Object.entries(fields)) $(element).value = row[key] || '';
  $('editGenres').value = (row.genres || []).join(', ');
  $('editSub').checked = Boolean(row.allow_sub);
  $('editDub').checked = Boolean(row.allow_dub);
  $('editAuto').checked = Boolean(row.auto_update);
  $('editAuto').disabled = !row.source_slug && !row.anikoto_id;
  $('editDetails').textContent = `${row.episode_count} episode${row.last_synced_at ? ' · Sinkron terakhir ' + new Date(row.last_synced_at).toLocaleString('id-ID') : ''}`;
  $('editError').textContent = '';
  $('editor').showModal();
}
$('closeEditor').onclick = () => $('editor').close();
$('editForm').onsubmit = event => {
  event.preventDefault();
  action(event.submitter, async () => {
    const original = rows.find(row => row.id === editing);
    const body = {
      title: $('editTitle').value, japanese_title: $('editJapanese').value, poster: $('editPoster').value, banner: $('editBanner').value,
      synopsis: $('editSynopsis').value, type: $('editType').value, status: $('editStatus').value, rating: $('editRating').value,
      publication_state: $('editPublication').value, genres: $('editGenres').value.split(',').map(value => value.trim()).filter(Boolean),
      allow_sub: $('editSub').checked, allow_dub: $('editDub').checked, auto_update: $('editAuto').checked,
    };
    if ($('editSlug').value !== original.public_slug) body.slug = $('editSlug').value;
    await client.request('/anime/' + editing, { method: 'PATCH', body });
    $('editor').close();
    await loadLibrary();
    notice('Perubahan anime berhasil disimpan. Website memperbarui data otomatis setiap 30 detik.');
  });
};

let storedToken = '';
try { storedToken = sessionStorage.getItem(tokenKey) || localStorage.getItem(tokenKey) || ''; } catch { /* Sign-in form remains available. */ }
if (storedToken) connect(storedToken).catch(error => { signedOut(); $('authError').textContent = error.message; });
