# AniKoto CMS — Frontend Integration (Phase E) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the AniJs frontend read from the stored CMS library instead of live-scraping, while streams are still resolved live at watch time.

**Architecture:** New `/api/library/*` serving endpoints read from SQLite; the homepage, detail, and watch pages switch their data source to them and navigate by the anime's internal library id. The watch page resolves streams per episode source — Anikoto episodes via `server_ids → /servers → /stream/resolve`, MAL/AniList episodes via the stored `embed_url → /stream/resolve-url`.

**Tech Stack:** Node 24 ESM, Express, better-sqlite3, existing extractors + `resolveStreamUrl`, vanilla frontend.

**Spec:** `docs/superpowers/specs/2026-08-27-anikoto-cms-design.md` (§9)

## Global Constraints

- URLs use the internal library id: `/anime/:id`, `/watch/:id/:ep` (mixed-source anime — MAL entries have no slug — so id is the only uniform key).
- Library home derivation: `latest` = anime by `updated_at DESC`; `top` = by numeric `rating DESC`; `spotlights` = first 6 of `latest`; `genres` = distinct across stored `genres`.
- Card items from the library carry `{ id, title, poster, sub, dub, type, rating }`.
- Streaming stays live: never store or serve media; resolve on demand.
- Response envelope `{ success, results }` as elsewhere.

---

### Task 1: Library read helpers + serving endpoints

**Files:**
- Modify: `src/db/library.repo.js` (add `homeSections`, `searchAnime`, `parseAnime`)
- Modify: `src/routes/apiRoutes.js` (add `/api/library/*` routes)
- Test: `src/db/library.home.test.mjs`

**Interfaces:**
- Produces:
  - `parseAnime(row)` → row with `genres`/`studios` JSON-parsed to arrays, and a `total_episodes` fallback.
  - `homeSections(db)` → `{ spotlights, latest, top, genres }`.
  - `searchAnime(db, keyword, limit=24)` → anime rows whose title matches.
  - routes: `GET /api/library/home`, `GET /api/library/anime/:id`, `GET /api/library/episodes/:id`, `GET /api/library/search`.

- [ ] **Step 1: Write the failing test**

```js
// src/db/library.home.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { openDb } from "./db.js";
import { upsertAnime, homeSections, searchAnime } from "./library.repo.js";

test("homeSections and searchAnime read stored anime", () => {
  const f = path.join(os.tmpdir(), `home-${Date.now()}.db`); const db = openDb(f);
  upsertAnime(db, { title: "Bleach", malId: 1, rating: "8.9", genres: ["Action"], poster: "p" });
  upsertAnime(db, { title: "Naruto", malId: 2, rating: "8.1", genres: ["Action", "Shounen"], poster: "q" });
  const h = homeSections(db);
  assert.equal(h.latest.length, 2);
  assert.equal(h.top[0].rating, "8.9", "top sorted by rating desc");
  assert.ok(h.genres.includes("Shounen"), "genres aggregated");
  assert.equal(searchAnime(db, "naru")[0].title, "Naruto");
  db.close(); for (const e of ["", "-wal", "-shm"]) fs.rmSync(f + e, { force: true });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test src/db/library.home.test.mjs` → FAIL (homeSections not exported).

- [ ] **Step 3: Implement in `src/db/library.repo.js` (append)**

```js
export function parseAnime(row) {
  if (!row) return row;
  const p = (s) => { try { return JSON.parse(s); } catch { return []; } };
  return { ...row, genres: p(row.genres), studios: p(row.studios) };
}

export function homeSections(db) {
  const latest = listAnime(db, { limit: 24 }).map(parseAnime);
  const top = db.prepare(
    "SELECT * FROM anime WHERE rating IS NOT NULL ORDER BY CAST(rating AS REAL) DESC LIMIT 10"
  ).all().map(parseAnime);
  const spotlights = latest.slice(0, 6);
  const genres = [...new Set(latest.flatMap(a => a.genres))].sort();
  return { spotlights, latest, top, genres };
}

export function searchAnime(db, keyword, limit = 24) {
  return db.prepare("SELECT * FROM anime WHERE title LIKE ? ORDER BY updated_at DESC LIMIT ?")
    .all(`%${keyword}%`, limit).map(parseAnime);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test src/db/library.home.test.mjs` → PASS.

- [ ] **Step 5: Add routes in `src/routes/apiRoutes.js`** (after the admin routes, before the closing `};`). Add imports `getAnimeById, getEpisodes, homeSections, searchAnime, parseAnime` to the existing `library.repo.js` import line.

```js
  // ---- FEATURE: Library serving (reads the CMS store) ----
  app.get("/api/library/home", (req, res) => {
    res.json({ success: true, results: homeSections(getDb()) });
  });
  app.get("/api/library/search", (req, res) => {
    const kw = (req.query.keyword || "").toString();
    res.json({ success: true, results: { data: searchAnime(getDb(), kw) } });
  });
  app.get("/api/library/anime/:id", (req, res) => {
    const a = parseAnime(getAnimeById(getDb(), Number(req.params.id)));
    if (!a) return res.status(404).json({ success: false, message: "Not in library" });
    res.json({ success: true, results: a });
  });
  app.get("/api/library/episodes/:id", (req, res) => {
    res.json({ success: true, results: getEpisodes(getDb(), Number(req.params.id)) });
  });
```

- [ ] **Step 6: Verify endpoints** (start server with `ADMIN_TOKEN=devtoken`, fetch one anikoto series via admin, then):

```bash
curl -s "http://localhost:4455/api/library/home" | head -c 200
curl -s "http://localhost:4455/api/library/search?keyword=one" | head -c 200
```

Expected: home returns spotlights/latest/top/genres; search returns `{data:[...]}`.

- [ ] **Step 7: Commit**

```bash
git add src/db/library.repo.js src/db/library.home.test.mjs src/routes/apiRoutes.js
git commit -m "feat: add library serving endpoints (home, anime, episodes, search)"
```

---

### Task 2: resolve-url endpoint for MAL episodes

**Files:**
- Modify: `src/routes/apiRoutes.js`
- Test: manual (HTTP glue over the tested `resolveStreamUrl` + guard).

**Interfaces:**
- Produces: `GET /api/stream/resolve-url?url=<megaplay embed>` → guards with `assertProxyableUrl`, calls `resolveStreamUrl`, returns `{ url, type, qualities, subtitles, skipData }`.

- [ ] **Step 1: Add the route (near the other stream routes)**

```js
  app.get("/api/stream/resolve-url", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, message: "url is required" });
    const check = assertProxyableUrl(url);
    if (!check.ok) return res.status(check.status).json({ success: false, message: check.message });
    const r = await resolveStreamUrl(url);
    if (!r.url) return res.status(502).json({ success: false, message: r.error || "no stream" });
    res.json({ success: true, results: r });
  });
```

- [ ] **Step 2: Verify**

```bash
curl -s "http://localhost:4455/api/stream/resolve-url?url=$(python -c "import urllib.parse;print(urllib.parse.quote('https://megaplay.buzz/stream/mal/61316/1/sub'))")" | head -c 200
```

Expected: `{success:true,results:{url:"https://…m3u8",qualities:[...]}}`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/apiRoutes.js
git commit -m "feat: add resolve-url endpoint for stored MAL embeds"
```

---

### Task 3: Homepage + navigation read from the library

**Files:**
- Modify: `public/assets/api.js` (id-based navigation; card carries id), `public/index.html` (loaders → library)

**Interfaces:**
- Consumes: `/api/library/home`, `/api/library/search`.
- Produces: cards navigate to `/anime/<id>`; homepage sections from the library.

- [ ] **Step 1: In `public/assets/api.js`, make cards navigate by id.** Replace the `animeHref` + the delegated listener + `cardHTML`'s wrapper so items carry `data-id` and navigate to `/anime/<id>`; keep `data-slug` support removed for cards to avoid the old collision.

```js
const animeHref = (id) => '/anime/' + encodeURIComponent(id);
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-id]');
  if (el && el.dataset.id) location.href = animeHref(el.dataset.id);
});
```

In `cardHTML`, change the wrapper to `<div class="card" data-id="${esc(item.id)}">` (drop `data-slug`). In the search dropdown rows in `wireNav`, change `data-slug="..."` to `data-id="${esc(it.id)}"`. In `mountNav`'s Random handler, change `location.href = animeHref(r.slug)` to navigate by a library id — Random now hits `/api/library/home` and picks a random `latest` item: replace the random block with

```js
  document.getElementById('navRandom').onclick = async () => {
    try { const h = await apiGet('/library/home'); const a = h.latest[Math.floor(h.latest.length * (Date.now() % 997 / 997))]; if (a) location.href = animeHref(a.id); } catch {}
  };
```

- [ ] **Step 2: In `public/index.html`, point loaders at the library.**

```js
    const loaders = {
      latest: () => apiGet('/library/home').then(h => h.latest),
      trending: () => apiGet('/library/home').then(h => h.top),
      popular: () => apiGet('/library/home').then(h => h.top),
    };
```

Change the hero + top-ten boot to use the library home in one call:

```js
    async function boot() {
      document.getElementById('heroInner').innerHTML = '<div class="skeleton" style="height:120px;width:60%"></div>';
      let home;
      try { home = await apiGet('/library/home'); } catch { return heroError(); }
      renderHero(home.spotlights || []);
      renderCards(document.getElementById('latest'), () => Promise.resolve(home.latest), { count: 12, empty: 'Library is empty — add anime in /admin.' });
      renderCards(document.getElementById('popular'), () => Promise.resolve(home.top), { count: 12, empty: 'Nothing yet.' });
      const topEl = document.getElementById('topten');
      topData = { today: home.top, week: home.top, month: home.top };
      renderTop(home.top);
    }
```

Update the nav search dropdown to search the library: in `wireNav` the search calls `/search?keyword=` — change to `/library/search?keyword=` (returns `{data}` too). The hero "Details" button uses `animeHref(it.id)`; ensure spotlight items have `id` (they do, from library).

- [ ] **Step 3: Verify in the browser** (server on a test port with a populated library): homepage hero + Latest + Popular + Top render library anime; clicking a card goes to `/anime/<id>`; nav search finds library titles.

- [ ] **Step 4: Commit**

```bash
git add public/assets/api.js public/index.html
git commit -m "feat: homepage and navigation read from the library"
```

---

### Task 4: Detail page reads the library by id

**Files:**
- Modify: `public/anime.html`, `server.js` (route already `/anime/:slug` — keep, the value is now an id)

**Interfaces:**
- Consumes: `/api/library/anime/:id`, `/api/library/episodes/:id`.

- [ ] **Step 1: In `public/anime.html`, read the id from the path and call the library.**

Replace the slug parse with:

```js
    const id = decodeURIComponent(location.pathname.replace(/^\/anime\//, '').replace(/\/$/, ''));
```

Replace the two fetches in `boot` with:

```js
        const [info, epsRows] = await Promise.all([
          apiGet('/library/anime/' + encodeURIComponent(id)),
          apiGet('/library/episodes/' + encodeURIComponent(id)).catch(() => []),
        ]);
        const eps = { totalEpisodes: epsRows.length, episodes: epsRows.map(e => ({ episode_no: e.number, title: e.title, active: false })) };
        renderDetail(info, eps);
```

In `renderDetail`, the episode tiles link to `/watch/<id>/<ep>` — change the `href` to use `id` (already `slug` variable; rename usage to `id`). The `backgroundImage`/`rating` cleaning stays. `info.animeId` may be absent — guard the "Score" fact (already guarded).

- [ ] **Step 2: Verify:** open `/anime/<id>` for a stored anime; metadata + episode grid render; an episode tile links to `/watch/<id>/<ep>`.

- [ ] **Step 3: Commit**

```bash
git add public/anime.html
git commit -m "feat: detail page reads the library by id"
```

---

### Task 5: Watch page — library episodes + dual-source streaming

**Files:**
- Modify: `public/watch.html`

**Interfaces:**
- Consumes: `/api/library/anime/:id`, `/api/library/episodes/:id`, `/api/servers`, `/api/stream/resolve`, `/api/stream/resolve-url`.

- [ ] **Step 1: Parse id from the path and load from the library.** Replace the slug/ep parse:

```js
    const parts = location.pathname.replace(/^\/watch\//, '').split('/');
    const id = decodeURIComponent(parts[0] || '');
    const epNo = decodeURIComponent(parts[1] || '1');
```

In `boot`, replace the `/episodes` + `/watch` fetches with library reads:

```js
        const [info, rows] = await Promise.all([
          apiGet('/library/anime/' + encodeURIComponent(id)),
          apiGet('/library/episodes/' + encodeURIComponent(id)),
        ]);
        episodes = rows.map(e => ({ episode_no: e.number, title: e.title, server_ids: e.server_ids, embed_url: e.embed_url, source: e.source }));
        const ep = episodes.find(e => String(e.episode_no) === String(epNo)) || episodes[0];
        if (!ep) throw new Error('Episode not found');
        const animeTitle = info.title;
```

Keep `renderEpisodeGrid`, `renderInfo(info)`, `renderRelated(info.recommended || [])` (library has none yet — pass `[]`), `renderCountdown(null)`. The episode-grid and info panels reuse `info` fields (title, poster, synopsis, genres via library row).

- [ ] **Step 2: Branch server rendering by episode source.** After choosing `ep`, replace the `/servers` fetch:

```js
        if (ep.source === 'anikoto' && ep.server_ids) {
          const servers = await apiGet('/servers?ids=' + encodeURIComponent(ep.server_ids));
          renderServers(servers);
        } else if (ep.embed_url) {
          // MAL/AniList: one synthetic server that resolves the stored embed URL
          renderEmbedServer(ep.embed_url);
        } else {
          showMsg('No playable source stored for this episode.');
        }
```

- [ ] **Step 3: Add `renderEmbedServer` + embed resolve.** Add near `renderServers`:

```js
    function renderEmbedServer(embedUrl) {
      const box = document.getElementById('servers');
      box.innerHTML = `<div class="servers-group"><h4>SUB</h4><div class="server-btns"><button class="server-btn on" id="embedBtn">MegaPlay</button></div></div>`;
      serverBtns = [document.getElementById('embedBtn')];
      serverMap = new Map([[serverBtns[0], { embedUrl }]]);
      tried = new Set();
      selectEmbed(embedUrl);
    }
    async function selectEmbed(embedUrl) {
      showMsg('Resolving stream…');
      try {
        const r = await apiGet('/stream/resolve-url?url=' + encodeURIComponent(embedUrl));
        if (!r.url) throw new Error(r.error || 'no stream');
        skipData = r.skipData || null; subtitles = r.subtitles || [];
        play(r.url);
      } catch (e) {
        showMsg(`Couldn't resolve this stream (${esc(e.message)}).`);
      }
    }
```

(`play`, `applySubtitle`, `buildMenu` already handle qualities/subs/skip from the resolved result via the shared globals `subtitles`/`skipData`.)

- [ ] **Step 4: Episode grid + nav use id.** In `renderEpisodeGrid` and the toolbar Prev/Next, the `epUrl` helper must build `/watch/<id>/<n>`:

```js
    const epUrl = (n) => `/watch/${encodeURIComponent(id)}/${encodeURIComponent(n)}`;
```

- [ ] **Step 5: Verify in the browser:** for a stored Anikoto series, `/watch/<id>/1` plays (server list + auto-fallback as before); for a stored MAL episode, `/watch/<id>/1` shows the MegaPlay server and plays. Captions/quality/skip still work.

- [ ] **Step 6: Commit**

```bash
git add public/watch.html
git commit -m "feat: watch page reads the library and resolves both stream sources"
```

---

## Self-Review notes

- **Spec §9 coverage:** library endpoints → Task 1; resolve-url → Task 2; homepage/detail/watch switch → Tasks 3–5; dual-source streaming → Task 5.
- **URL scheme change:** `/anime/:slug`→`:id`, `/watch/:slug/:ep`→`:id` — the server routes are pattern-matched (`:slug`) so they still serve the same shells; only the client-side interpretation changes. Old slug-based bookmarks will 404 at the library lookup — acceptable for a fresh CMS-backed site.
- **Empty library:** every section shows an empty-state pointing at `/admin`; nothing throws.
- **Live streaming preserved:** Task 5 keeps the Anikoto server flow and adds the MAL embed flow; no media is stored.
