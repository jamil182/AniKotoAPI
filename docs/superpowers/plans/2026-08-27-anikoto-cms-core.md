# AniKoto CMS Core (Phases A–D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a token-protected admin CMS that fetches anime (by Anikoto slug or by MAL/AniList id) and stores it in SQLite, with an hourly auto-update job.

**Architecture:** A SQLite storage layer (`src/db/`) with a pure repository module; admin ingest endpoints under `/api/admin/*` behind a token middleware that reuse the existing extractors and stream resolver; a static `/admin` page with the two ingest panels; and an in-process hourly scheduler plus a manual trigger endpoint.

**Tech Stack:** Node 24 (ESM), Express 4, better-sqlite3, the project's existing extractors (`animeInfo`, `episodeList`, `streamResolver`) and `node --test` for unit tests.

**Spec:** `docs/superpowers/specs/2026-08-27-anikoto-cms-design.md`

## Global Constraints

- ESM only (`"type": "module"`); use `import`/`export`, no `require` except the existing `createRequire` pattern.
- SQLite file lives at `data/anikoto.db`; the `data/` dir is git-ignored.
- Admin routes fail closed: if `process.env.ADMIN_TOKEN` is unset, return 503; if the request token is missing/wrong, return 401.
- Admin token is read from the `x-admin-token` header (fallback `?token=`).
- MAL/AniList embed URL pattern is exactly `https://megaplay.buzz/stream/{source}/{id}/{episode}/{sub|dub}` where source ∈ {mal, anilist}.
- Merge resolution order for an existing anime: `anikoto_id` → `mal_id` → `anilist_id` → case-insensitive `title`.
- Response envelope matches the project: `{ success: true, results: ... }` / `{ success: false, message }`.
- Unit tests are `*.test.mjs` run with `node --test`; use a temp DB file per test, never `data/anikoto.db`.

---

### Task 1: SQLite connection and migrations

**Files:**
- Create: `src/db/db.js`
- Modify: `package.json` (add `better-sqlite3` dependency), `.gitignore` (add `data/`)
- Test: `src/db/db.test.mjs`

**Interfaces:**
- Produces: `openDb(path?: string): Database` — opens (creating dirs), enables WAL, runs migrations, returns a better-sqlite3 `Database`. Default path `data/anikoto.db`. `migrate(db): void` creates the `anime` and `episode` tables if absent.

- [ ] **Step 1: Add the dependency**

Run: `npm install better-sqlite3`
Expected: installs (prebuilt binary for Node 24).

- [ ] **Step 2: Ignore the data dir**

Add a line `data/` to `.gitignore`.

- [ ] **Step 3: Write the failing test**

```js
// src/db/db.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from './db.js';

test('openDb creates anime and episode tables', () => {
  const file = path.join(os.tmpdir(), `anikoto-test-${Date.now()}.db`);
  const db = openDb(file);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  assert.ok(tables.includes('anime'), 'anime table exists');
  assert.ok(tables.includes('episode'), 'episode table exists');
  db.close();
  fs.rmSync(file, { force: true });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --test src/db/db.test.mjs`
Expected: FAIL — cannot find `./db.js`.

- [ ] **Step 5: Write minimal implementation**

```js
// src/db/db.js
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_PATH = path.join(process.cwd(), 'data', 'anikoto.db');

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS anime (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anikoto_id INTEGER, mal_id INTEGER, anilist_id INTEGER,
      slug TEXT, title TEXT NOT NULL, japanese_title TEXT,
      poster TEXT, banner TEXT, synopsis TEXT, type TEXT, status TEXT,
      genres TEXT, studios TEXT, rating TEXT, total_episodes INTEGER,
      auto_update INTEGER DEFAULT 0,
      created_at TEXT, updated_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_anime_anikoto ON anime(anikoto_id) WHERE anikoto_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_anime_mal ON anime(mal_id) WHERE mal_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_anime_anilist ON anime(anilist_id) WHERE anilist_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS episode (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anime_id INTEGER NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
      number INTEGER NOT NULL, title TEXT,
      sub INTEGER DEFAULT 0, dub INTEGER DEFAULT 0,
      server_ids TEXT, embed_url TEXT, source TEXT,
      created_at TEXT, updated_at TEXT,
      UNIQUE(anime_id, number)
    );
  `);
}

export function openDb(file = DEFAULT_PATH) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test src/db/db.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore src/db/db.js src/db/db.test.mjs
git commit -m "feat: add SQLite connection and migrations for the CMS"
```

---

### Task 2: Anime upsert with merge

**Files:**
- Create: `src/db/library.repo.js`
- Test: `src/db/library.repo.test.mjs`

**Interfaces:**
- Consumes: `openDb` from Task 1.
- Produces (all take the `db` as first arg so tests can inject a temp db):
  - `upsertAnime(db, record): number` — record `{ anikotoId?, malId?, anilistId?, slug?, title, japaneseTitle?, poster?, banner?, synopsis?, type?, status?, genres?(array), studios?(array), rating?, totalEpisodes?, autoUpdate?(bool) }`. Resolves an existing row by `anikoto_id → mal_id → anilist_id → lower(title)`; updates it (only overwriting non-null incoming fields) or inserts. Returns the anime id.
  - `getAnimeByAny(db, { anikotoId, malId, anilistId, title }): row|undefined`

- [ ] **Step 1: Write the failing test**

```js
// src/db/library.repo.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from './db.js';
import { upsertAnime, getAnimeByAny } from './library.repo.js';

function tmpDb() {
  const file = path.join(os.tmpdir(), `anikoto-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = openDb(file);
  return { db, cleanup: () => { db.close(); fs.rmSync(file, { force: true }); } };
}

test('upsertAnime inserts then merges by mal_id without duplicating', () => {
  const { db, cleanup } = tmpDb();
  const id1 = upsertAnime(db, { malId: 21, title: 'One Piece', type: 'TV' });
  const id2 = upsertAnime(db, { malId: 21, title: 'One Piece', status: 'Airing' });
  assert.equal(id1, id2, 'same row reused on matching mal_id');
  const row = getAnimeByAny(db, { malId: 21 });
  assert.equal(row.type, 'TV', 'first non-null field kept');
  assert.equal(row.status, 'Airing', 'later field filled in');
  const count = db.prepare('SELECT COUNT(*) c FROM anime').get().c;
  assert.equal(count, 1, 'no duplicate');
  cleanup();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/db/library.repo.test.mjs`
Expected: FAIL — cannot find `./library.repo.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/db/library.repo.js
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const jarr = (v) => Array.isArray(v) ? JSON.stringify(v) : (v ?? null);

export function getAnimeByAny(db, { anikotoId, malId, anilistId, title } = {}) {
  if (anikotoId) { const r = db.prepare('SELECT * FROM anime WHERE anikoto_id = ?').get(anikotoId); if (r) return r; }
  if (malId) { const r = db.prepare('SELECT * FROM anime WHERE mal_id = ?').get(malId); if (r) return r; }
  if (anilistId) { const r = db.prepare('SELECT * FROM anime WHERE anilist_id = ?').get(anilistId); if (r) return r; }
  if (title) { const r = db.prepare('SELECT * FROM anime WHERE lower(title) = lower(?)').get(title); if (r) return r; }
  return undefined;
}

export function upsertAnime(db, rec) {
  const existing = getAnimeByAny(db, { anikotoId: rec.anikotoId, malId: rec.malId, anilistId: rec.anilistId, title: rec.title });
  const fields = {
    anikoto_id: rec.anikotoId ?? null, mal_id: rec.malId ?? null, anilist_id: rec.anilistId ?? null,
    slug: rec.slug ?? null, title: rec.title, japanese_title: rec.japaneseTitle ?? null,
    poster: rec.poster ?? null, banner: rec.banner ?? null, synopsis: rec.synopsis ?? null,
    type: rec.type ?? null, status: rec.status ?? null, genres: jarr(rec.genres), studios: jarr(rec.studios),
    rating: rec.rating ?? null, total_episodes: rec.totalEpisodes ?? null,
    auto_update: rec.autoUpdate ? 1 : 0,
  };
  if (existing) {
    // overwrite only where the incoming value is non-null
    const sets = [], vals = [];
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'auto_update' || v !== null) { sets.push(`${k} = ?`); vals.push(v); }
    }
    sets.push('updated_at = ?'); vals.push(now());
    vals.push(existing.id);
    db.prepare(`UPDATE anime SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return existing.id;
  }
  const cols = Object.keys(fields).concat(['created_at', 'updated_at']);
  const placeholders = cols.map(() => '?').join(', ');
  const vals = Object.values(fields).concat([now(), now()]);
  const info = db.prepare(`INSERT INTO anime (${cols.join(', ')}) VALUES (${placeholders})`).run(...vals);
  return info.lastInsertRowid;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/db/library.repo.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/library.repo.js src/db/library.repo.test.mjs
git commit -m "feat: add anime upsert with merge to the library repo"
```

---

### Task 2b: Episode upsert and read queries

**Files:**
- Modify: `src/db/library.repo.js`
- Test: `src/db/library.repo.test.mjs`

**Interfaces:**
- Produces:
  - `upsertEpisode(db, animeId, ep): void` — ep `{ number, title?, sub?(bool), dub?(bool), serverIds?, embedUrl?, source }`. Insert or update by `(anime_id, number)`.
  - `getEpisodes(db, animeId): row[]` ordered by `number`.
  - `listAnime(db, { limit=50, offset=0 } = {}): row[]` newest first.
  - `getAnimeById(db, id): row|undefined`
  - `deleteAnime(db, id): void`
  - `animeForAutoUpdate(db): row[]`

- [ ] **Step 1: Write the failing test**

```js
// append to src/db/library.repo.test.mjs
import { upsertEpisode, getEpisodes, listAnime, deleteAnime } from './library.repo.js';

test('upsertEpisode inserts then updates by (anime_id, number)', () => {
  const { db, cleanup } = tmpDb();
  const id = upsertAnime(db, { title: 'Test', malId: 99 });
  upsertEpisode(db, id, { number: 1, sub: true, source: 'mal', embedUrl: 'x' });
  upsertEpisode(db, id, { number: 1, dub: true, source: 'mal', embedUrl: 'y' });
  const eps = getEpisodes(db, id);
  assert.equal(eps.length, 1, 'no duplicate episode');
  assert.equal(eps[0].embed_url, 'y', 'updated in place');
  assert.equal(eps[0].dub, 1);
  cleanup();
});

test('deleteAnime cascades to episodes', () => {
  const { db, cleanup } = tmpDb();
  const id = upsertAnime(db, { title: 'Gone', malId: 5 });
  upsertEpisode(db, id, { number: 1, source: 'mal' });
  deleteAnime(db, id);
  assert.equal(listAnime(db).length, 0);
  assert.equal(getEpisodes(db, id).length, 0, 'episodes cascade-deleted');
  cleanup();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/db/library.repo.test.mjs`
Expected: FAIL — `upsertEpisode` is not exported.

- [ ] **Step 3: Write minimal implementation**

```js
// append to src/db/library.repo.js
export function upsertEpisode(db, animeId, ep) {
  db.prepare(`
    INSERT INTO episode (anime_id, number, title, sub, dub, server_ids, embed_url, source, created_at, updated_at)
    VALUES (@anime_id, @number, @title, @sub, @dub, @server_ids, @embed_url, @source, @now, @now)
    ON CONFLICT(anime_id, number) DO UPDATE SET
      title = COALESCE(excluded.title, episode.title),
      sub = MAX(episode.sub, excluded.sub),
      dub = MAX(episode.dub, excluded.dub),
      server_ids = COALESCE(excluded.server_ids, episode.server_ids),
      embed_url = COALESCE(excluded.embed_url, episode.embed_url),
      source = excluded.source,
      updated_at = @now
  `).run({
    anime_id: animeId, number: ep.number, title: ep.title ?? null,
    sub: ep.sub ? 1 : 0, dub: ep.dub ? 1 : 0,
    server_ids: ep.serverIds ?? null, embed_url: ep.embedUrl ?? null,
    source: ep.source, now: now(),
  });
}

export const getEpisodes = (db, animeId) =>
  db.prepare('SELECT * FROM episode WHERE anime_id = ? ORDER BY number').all(animeId);
export const listAnime = (db, { limit = 50, offset = 0 } = {}) =>
  db.prepare('SELECT * FROM anime ORDER BY updated_at DESC LIMIT ? OFFSET ?').all(limit, offset);
export const getAnimeById = (db, id) => db.prepare('SELECT * FROM anime WHERE id = ?').get(id);
export const deleteAnime = (db, id) => db.prepare('DELETE FROM anime WHERE id = ?').run(id);
export const animeForAutoUpdate = (db) => db.prepare('SELECT * FROM anime WHERE auto_update = 1').all();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/db/library.repo.test.mjs`
Expected: PASS (all four tests).

- [ ] **Step 5: Commit**

```bash
git add src/db/library.repo.js src/db/library.repo.test.mjs
git commit -m "feat: add episode upsert and library read queries"
```

---

### Task 3: Shared DB singleton and admin auth middleware

**Files:**
- Create: `src/db/index.js`, `src/middleware/adminAuth.js`
- Modify: `.env.example`
- Test: `src/middleware/adminAuth.test.mjs`

**Interfaces:**
- Consumes: `openDb` (Task 1).
- Produces:
  - `getDb(): Database` — lazily opens the default DB once and returns the singleton (used by routes/scheduler; tests keep using their own temp db).
  - `adminAuth(req, res, next)` — 503 if `ADMIN_TOKEN` unset; 401 if `req.get('x-admin-token') || req.query.token` mismatches; else `next()`.

- [ ] **Step 1: Write the failing test**

```js
// src/middleware/adminAuth.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminAuth } from './adminAuth.js';

function run(headers, envToken) {
  const prev = process.env.ADMIN_TOKEN;
  if (envToken === undefined) delete process.env.ADMIN_TOKEN; else process.env.ADMIN_TOKEN = envToken;
  let status = 200, nexted = false;
  const req = { get: (h) => headers[h.toLowerCase()], query: {} };
  const res = { status(c) { status = c; return this; }, json() { return this; } };
  adminAuth(req, res, () => { nexted = true; });
  process.env.ADMIN_TOKEN = prev;
  return { status, nexted };
}

test('adminAuth fails closed when token unset', () => {
  assert.equal(run({}, undefined).status, 503);
});
test('adminAuth 401 on wrong token', () => {
  assert.equal(run({ 'x-admin-token': 'nope' }, 'secret').status, 401);
});
test('adminAuth passes on correct token', () => {
  const r = run({ 'x-admin-token': 'secret' }, 'secret');
  assert.equal(r.nexted, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/middleware/adminAuth.test.mjs`
Expected: FAIL — cannot find `./adminAuth.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/db/index.js
import { openDb } from './db.js';
let _db = null;
export function getDb() { if (!_db) _db = openDb(); return _db; }
```

```js
// src/middleware/adminAuth.js
export function adminAuth(req, res, next) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return res.status(503).json({ success: false, message: 'Admin is not configured (set ADMIN_TOKEN).' });
  const got = req.get('x-admin-token') || req.query.token;
  if (got !== expected) return res.status(401).json({ success: false, message: 'Invalid admin token.' });
  next();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/middleware/adminAuth.test.mjs`
Expected: PASS.

- [ ] **Step 5: Document the env var**

Append to `.env.example`:

```
# Admin CMS token — required to use /admin and /api/admin/*. Unset = admin disabled.
# ADMIN_TOKEN=change-me
```

- [ ] **Step 6: Commit**

```bash
git add src/db/index.js src/middleware/adminAuth.js src/middleware/adminAuth.test.mjs .env.example
git commit -m "feat: add DB singleton and fail-closed admin auth middleware"
```

---

### Task 4: Admin ingest service (fetch-anikoto, fetch-mal)

**Files:**
- Create: `src/services/adminIngest.js`
- Test: `src/services/adminIngest.test.mjs`

**Interfaces:**
- Consumes: `upsertAnime`, `upsertEpisode`, `getAnimeByAny` (Task 2/2b); `resolveStreamUrl` from `../extractors/streamResolver.extractor.js`.
- Produces:
  - `malEmbedUrl({ source, id, episode, dub }): string` — returns `https://megaplay.buzz/stream/{source}/{id}/{episode}/{dub ? 'dub' : 'sub'}`.
  - `ingestAnikoto(db, { info, episodes, sub, dub, autoUpdate }): { animeId, episodeCount }` — pure: takes already-fetched `info` (from getAnimeInfo shape) and `episodes` (from getEpisodeList shape), upserts anime + episodes with `source:'anikoto'`.
  - `ingestMalEpisode(db, { source, id, episode, sub, dub, resolved }): { animeId }` — upserts a minimal anime keyed by mal/anilist id (title `"<SOURCE> <id>"` if new) and the one episode with `embed_url` + `source`.

The HTTP layer (Task 5) does the network fetches and passes results in, so this service is unit-testable without network.

- [ ] **Step 1: Write the failing test**

```js
// src/services/adminIngest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { openDb } from '../db/db.js';
import { getEpisodes, getAnimeByAny } from '../db/library.repo.js';
import { malEmbedUrl, ingestAnikoto, ingestMalEpisode } from './adminIngest.js';

const tmpDb = () => { const f = path.join(os.tmpdir(), `ing-${Date.now()}-${Math.random().toString(36).slice(2)}.db`); const db = openDb(f); return { db, cleanup: () => { db.close(); fs.rmSync(f, { force: true }); } }; };

test('malEmbedUrl builds the megaplay pattern', () => {
  assert.equal(malEmbedUrl({ source: 'mal', id: 21, episode: 3, dub: false }), 'https://megaplay.buzz/stream/mal/21/3/sub');
  assert.equal(malEmbedUrl({ source: 'anilist', id: 5, episode: 1, dub: true }), 'https://megaplay.buzz/stream/anilist/5/1/dub');
});

test('ingestAnikoto stores anime and episodes', () => {
  const { db, cleanup } = tmpDb();
  const info = { animeId: 1498, slug: 'naruto', title: 'Naruto', genres: ['Action'], studios: ['Pierrot'] };
  const episodes = [{ episode_no: 1, title: 'A', server_ids: 'TOK1' }, { episode_no: 2, server_ids: 'TOK2' }];
  const r = ingestAnikoto(db, { info, episodes, sub: true, dub: false, autoUpdate: true });
  assert.equal(r.episodeCount, 2);
  const row = getAnimeByAny(db, { anikotoId: 1498 });
  assert.equal(row.auto_update, 1);
  assert.equal(getEpisodes(db, r.animeId)[0].server_ids, 'TOK1');
  cleanup();
});

test('ingestMalEpisode merges one episode by mal id', () => {
  const { db, cleanup } = tmpDb();
  const r = ingestMalEpisode(db, { source: 'mal', id: 61316, episode: 1, sub: true, dub: false, resolved: { url: 'x' }, embedUrl: 'https://megaplay.buzz/stream/mal/61316/1/sub' });
  const eps = getEpisodes(db, r.animeId);
  assert.equal(eps.length, 1);
  assert.equal(eps[0].embed_url, 'https://megaplay.buzz/stream/mal/61316/1/sub');
  assert.equal(eps[0].source, 'mal');
  cleanup();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/services/adminIngest.test.mjs`
Expected: FAIL — cannot find `./adminIngest.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/services/adminIngest.js
import { upsertAnime, upsertEpisode } from '../db/library.repo.js';

export function malEmbedUrl({ source, id, episode, dub }) {
  return `https://megaplay.buzz/stream/${source}/${id}/${episode}/${dub ? 'dub' : 'sub'}`;
}

export function ingestAnikoto(db, { info, episodes, sub, dub, autoUpdate }) {
  const animeId = upsertAnime(db, {
    anikotoId: info.animeId || null, slug: info.slug, title: info.title,
    japaneseTitle: info.japaneseTitle, poster: info.poster, banner: info.backgroundImage,
    synopsis: info.synopsis, type: info.type, status: info.status,
    genres: info.genres, studios: info.studios, rating: info.rating,
    totalEpisodes: episodes.length, autoUpdate,
  });
  for (const e of episodes) {
    upsertEpisode(db, animeId, {
      number: Number(e.episode_no), title: e.title || null,
      sub: !!sub, dub: !!dub, serverIds: e.server_ids || null, source: 'anikoto',
    });
  }
  return { animeId, episodeCount: episodes.length };
}

export function ingestMalEpisode(db, { source, id, episode, sub, dub, embedUrl }) {
  const key = source === 'anilist' ? { anilistId: Number(id) } : { malId: Number(id) };
  const animeId = upsertAnime(db, { ...key, title: `${source.toUpperCase()} ${id}` });
  upsertEpisode(db, animeId, {
    number: Number(episode), sub: !!sub, dub: !!dub, embedUrl, source,
  });
  return { animeId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/services/adminIngest.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/adminIngest.js src/services/adminIngest.test.mjs
git commit -m "feat: add admin ingest service (anikoto + mal)"
```

---

### Task 5: Admin routes wired into the API

**Files:**
- Modify: `src/routes/apiRoutes.js` (add admin routes + imports), `server.js` (nothing if routes are registered in apiRoutes; verify)
- Test: manual end-to-end via curl (documented below) — no unit test, this is HTTP glue over already-tested units.

**Interfaces:**
- Consumes: `adminAuth` (Task 3), `getDb` (Task 3), `ingestAnikoto`/`ingestMalEpisode`/`malEmbedUrl` (Task 4), `listAnime`/`getAnimeById`/`getEpisodes`/`deleteAnime` (Task 2b); existing `getAnimeInfo`? No — call the extractors directly: `extractAnimeInfo`, `extractEpisodeList` from `../extractors/`, and `resolveStreamUrl` from `../extractors/streamResolver.extractor.js`.
- Produces: routes `GET /api/admin/search`, `POST /api/admin/fetch-anikoto`, `POST /api/admin/fetch-mal`, `GET /api/admin/library`, `DELETE /api/admin/anime/:id`.

- [ ] **Step 1: Add imports at the top of `createApiRoutes` region in `src/routes/apiRoutes.js`**

```js
import { adminAuth } from "../middleware/adminAuth.js";
import { getDb } from "../db/index.js";
import { ingestAnikoto, ingestMalEpisode, malEmbedUrl } from "../services/adminIngest.js";
import { listAnime, getAnimeById, getEpisodes, deleteAnime } from "../db/library.repo.js";
import { extractAnimeInfo } from "../extractors/animeInfo.extractor.js";
import { extractEpisodeList } from "../extractors/episodeList.extractor.js";
import { extractSearchResults } from "../extractors/search.extractor.js";
import { resolveStreamUrl } from "../extractors/streamResolver.extractor.js";
```

(These export names are confirmed present in the codebase: `extractAnimeInfo(slug)`, `extractEpisodeList(slug)`, `extractSearchResults(keyword, page)`, `resolveStreamUrl(embedUrl)`.)

- [ ] **Step 2: Register the admin routes (inside `createApiRoutes`, after the existing routes)**

```js
  app.use("/api/admin", adminAuth);

  app.get("/api/admin/search", async (req, res) => {
    try {
      const kw = (req.query.keyword || "").toString();
      const data = await extractSearchResults(kw, 1);
      const items = (data.data || []).map(a => ({ animeId: a.animeId, slug: (a.slug || "").split("/")[0], title: a.title, poster: a.poster, type: a.type, sub: a.sub, dub: a.dub }));
      res.json({ success: true, results: items });
    } catch (e) { res.status(502).json({ success: false, message: e.message }); }
  });

  app.post("/api/admin/fetch-anikoto", async (req, res) => {
    try {
      const { slug, sub = true, dub = false, autoUpdate = false } = req.body || {};
      if (!slug) return res.status(400).json({ success: false, message: "slug is required" });
      const info = await extractAnimeInfo(slug);
      const epData = await extractEpisodeList(slug);
      const result = ingestAnikoto(getDb(), { info: { ...info, slug }, episodes: epData.episodes || [], sub, dub, autoUpdate });
      res.json({ success: true, results: result });
    } catch (e) { res.status(502).json({ success: false, message: e.message }); }
  });

  app.post("/api/admin/fetch-mal", async (req, res) => {
    try {
      const { source, id, episode, sub = true, dub = false } = req.body || {};
      if (!["mal", "anilist"].includes(source) || !id || !episode)
        return res.status(400).json({ success: false, message: "source (mal|anilist), id and episode are required" });
      const embedUrl = malEmbedUrl({ source, id, episode, dub });
      const resolved = await resolveStreamUrl(embedUrl);
      if (!resolved.url) return res.status(502).json({ success: false, message: `Could not resolve: ${resolved.error || "no stream"}` });
      const result = ingestMalEpisode(getDb(), { source, id, episode, sub, dub, embedUrl });
      res.json({ success: true, results: { ...result, embedUrl } });
    } catch (e) { res.status(502).json({ success: false, message: e.message }); }
  });

  app.get("/api/admin/library", (req, res) => {
    const rows = listAnime(getDb());
    res.json({ success: true, results: rows });
  });

  app.delete("/api/admin/anime/:id", (req, res) => {
    deleteAnime(getDb(), Number(req.params.id));
    res.json({ success: true, results: { deleted: Number(req.params.id) } });
  });
```


- [ ] **Step 3: Set a token and start the server**

```bash
printf '\nADMIN_TOKEN=devtoken\n' >> .env
node ./server.js
```

- [ ] **Step 4: Verify auth + ingest end to end**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4444/api/admin/library"
curl -s -H "x-admin-token: devtoken" "http://localhost:4444/api/admin/library"
curl -s -H "x-admin-token: devtoken" -H "content-type: application/json" -X POST \
  -d '{"slug":"one-piece-wano-kuni-sp-r0xwk","sub":true,"autoUpdate":true}' \
  "http://localhost:4444/api/admin/fetch-anikoto"
```

Expected: first 401; second `{success:true,results:[]}`; third `{success:true,results:{animeId:...,episodeCount:22}}`, and a re-run of `library` now lists the anime.

- [ ] **Step 5: Commit**

```bash
git add src/routes/apiRoutes.js
git commit -m "feat: add admin ingest and library routes"
```

---

### Task 6: Admin UI page

**Files:**
- Create: `public/admin.html`
- Modify: `server.js` (add `app.get("/admin", ...)` serving the page, gated by `adminAuth`), `public/assets/app.css` (admin panel styles)

**Interfaces:**
- Consumes: the Task 5 routes; sends `x-admin-token` from a value the page prompts for once and stores in `localStorage` under `anijs_admin_token`.
- Produces: the `/admin` page.

- [ ] **Step 1: Add the route in `server.js` next to `/docs`**

```js
import { adminAuth } from "./src/middleware/adminAuth.js";
// ...
app.get("/admin", adminAuth, (req, res) => {
  res.sendFile(path.join(publicDir, "admin.html"));
});
```

Note: because `adminAuth` reads the token from a header/query, the page itself is reachable only with `?token=`; simplest is to gate the API only and let the static page load, then the page's JS supplies the token to the API. Choose ONE: (a) gate only the API (page loads, JS holds token) — RECOMMENDED, simpler; drop `adminAuth` from this route. (b) gate the page too and require `?token=`. Implement (a).

Revised route:

```js
app.get("/admin", (req, res) => {
  res.sendFile(path.join(publicDir, "admin.html"));
});
```

- [ ] **Step 2: Create `public/admin.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AniJs — Admin</title>
  <link rel="stylesheet" href="/assets/app.css" />
</head>
<body>
  <header id="nav"></header>
  <div class="wrap" style="padding:28px 0 60px">
    <h1 style="font-family:var(--font-display);color:var(--ink)">Anime Fetch Data</h1>
    <p style="color:var(--muted)">Fetch a complete series via Anikoto, or add one episode via MAL/AniList.</p>
    <div class="admin-grid">
      <section class="admin-card">
        <h3>1. Fetch Anikoto</h3>
        <label>Search anime title</label>
        <div class="admin-row"><input id="aSearch" placeholder="Naruto: Shippuden"><button class="btn primary" id="aSearchBtn">Search</button></div>
        <div id="aResults"></div>
        <label>Anikoto Series ID</label>
        <input id="aSeriesId" placeholder="—" readonly>
        <div class="admin-langs"><label><input type="checkbox" id="aSub" checked> SUB</label><label><input type="checkbox" id="aDub"> DUB</label></div>
        <label><input type="checkbox" id="aAuto"> Automatic hourly episode updates</label>
        <button class="btn primary" id="aFetch" disabled>Fetch Anikoto</button>
        <div id="aOut" class="admin-out"></div>
      </section>
      <section class="admin-card">
        <h3>2. Fetch MAL/AniList Episode</h3>
        <label>Source</label>
        <select id="mSource"><option value="mal">MAL ID + episode</option><option value="anilist">AniList ID + episode</option></select>
        <div class="admin-row"><input id="mId" placeholder="61316"><input id="mEp" placeholder="1" value="1"></div>
        <div class="admin-langs"><label><input type="checkbox" id="mSub" checked> SUB</label><label><input type="checkbox" id="mDub"> DUB</label></div>
        <div class="admin-out" id="mPreview"></div>
        <button class="btn primary" id="mFetch">Fetch MAL/AniList Episode</button>
        <div id="mOut" class="admin-out"></div>
      </section>
    </div>
    <h2 style="font-family:var(--font-display);color:var(--ink);margin-top:32px">Library</h2>
    <div id="library"></div>
  </div>
  <script src="/assets/api.js"></script>
  <script>
    mountNav();
    let TOKEN = null;
    try { TOKEN = localStorage.getItem('anijs_admin_token'); } catch {}
    if (!TOKEN) { TOKEN = prompt('Admin token:') || ''; try { localStorage.setItem('anijs_admin_token', TOKEN); } catch {} }
    const H = { 'x-admin-token': TOKEN, 'content-type': 'application/json' };
    const adminGet = async (p) => (await fetch('/api/admin' + p, { headers: H })).json();
    const adminPost = async (p, body) => (await fetch('/api/admin' + p, { method: 'POST', headers: H, body: JSON.stringify(body) })).json();

    // Fetch Anikoto — search
    document.getElementById('aSearchBtn').onclick = async () => {
      const r = await adminGet('/search?keyword=' + encodeURIComponent(document.getElementById('aSearch').value.trim()));
      const box = document.getElementById('aResults');
      box.innerHTML = (r.results || []).slice(0, 8).map(a =>
        `<div class="admin-hit" data-slug="${a.slug}" data-id="${a.animeId}"><img src="${a.poster}" onerror="this.style.display='none'"><div><b>${a.title}</b><div class="admin-hit-m">ID ${a.animeId} · ${a.type || ''} · SUB ${a.sub||0} DUB ${a.dub||0}</div></div><button class="btn">Select</button></div>`).join('');
      box.querySelectorAll('.admin-hit').forEach(el => el.querySelector('button').onclick = () => {
        document.getElementById('aSeriesId').value = el.dataset.id;
        document.getElementById('aFetch').disabled = false;
        document.getElementById('aFetch').dataset.slug = el.dataset.slug;
      });
    };
    document.getElementById('aFetch').onclick = async (e) => {
      const out = document.getElementById('aOut'); out.textContent = 'Fetching…';
      const r = await adminPost('/fetch-anikoto', { slug: e.target.dataset.slug, sub: aSub.checked, dub: aDub.checked, autoUpdate: aAuto.checked });
      out.textContent = r.success ? `Stored — ${r.results.episodeCount} episodes.` : 'Error: ' + r.message;
      loadLibrary();
    };

    // Fetch MAL — live preview + submit
    const preview = () => { document.getElementById('mPreview').textContent = `https://megaplay.buzz/stream/${mSource.value}/${mId.value||'ID'}/${mEp.value||'1'}/${mDub.checked?'dub':'sub'}`; };
    ['mSource','mId','mEp','mSub','mDub'].forEach(id => document.getElementById(id).addEventListener('input', preview)); preview();
    document.getElementById('mFetch').onclick = async () => {
      const out = document.getElementById('mOut'); out.textContent = 'Fetching…';
      const r = await adminPost('/fetch-mal', { source: mSource.value, id: mId.value.trim(), episode: mEp.value.trim(), sub: mSub.checked, dub: mDub.checked });
      out.textContent = r.success ? 'Stored episode.' : 'Error: ' + r.message;
      loadLibrary();
    };

    async function loadLibrary() {
      const r = await adminGet('/library');
      document.getElementById('library').innerHTML = (r.results || []).map(a =>
        `<div class="admin-libitem"><b>${a.title}</b> <span class="admin-hit-m">${a.total_episodes||0} ep${a.auto_update?' · auto':''}</span> <button class="btn" data-del="${a.id}">Delete</button></div>`).join('') || '<div class="state">Empty.</div>';
      document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { await fetch('/api/admin/anime/' + b.dataset.del, { method: 'DELETE', headers: H }); loadLibrary(); });
    }
    loadLibrary();
  </script>
</body>
</html>
```

- [ ] **Step 3: Add admin styles to `public/assets/app.css`**

```css
/* ---- Admin ---- */
.admin-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px; }
@media (max-width: 820px) { .admin-grid { grid-template-columns: 1fr; } }
.admin-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
.admin-card h3 { font-family: var(--font-display); color: var(--ink); margin: 0 0 12px; }
.admin-card label { display: block; font-size: .78rem; color: var(--muted); margin: 12px 0 4px; }
.admin-card input[type=text], .admin-card input:not([type]), .admin-card select { width: 100%; padding: 9px 12px; border-radius: 8px; background: var(--bg-soft); border: 1px solid var(--border-hi); color: var(--ink); font-family: var(--font-body); }
.admin-row { display: flex; gap: 8px; } .admin-row input { flex: 1; }
.admin-langs { display: flex; gap: 16px; margin: 10px 0; } .admin-langs label { display: inline-flex; gap: 6px; align-items: center; margin: 0; color: var(--body); }
.admin-hit { display: flex; gap: 10px; align-items: center; padding: 8px; border: 1px solid var(--border); border-radius: 8px; margin: 6px 0; }
.admin-hit img { width: 40px; height: 56px; object-fit: cover; border-radius: 6px; }
.admin-hit b { color: var(--ink); font-size: .85rem; } .admin-hit-m { color: var(--muted); font-size: .72rem; }
.admin-hit button { margin-left: auto; }
.admin-out { margin-top: 10px; font-family: var(--font-code, monospace); font-size: .78rem; color: var(--body); word-break: break-all; }
.admin-libitem { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border); }
.admin-libitem b { color: var(--ink); } .admin-libitem button { margin-left: auto; }
```

- [ ] **Step 4: Verify in the browser**

Start the server (with `ADMIN_TOKEN=devtoken`), open `http://localhost:4444/admin`, enter the token, search a title, Select, Fetch Anikoto, and confirm the row appears under Library. Then use panel 2 with MAL id `61316` episode `1` and confirm "Stored episode."

- [ ] **Step 5: Commit**

```bash
git add public/admin.html public/assets/app.css server.js
git commit -m "feat: add admin CMS page"
```

---

### Task 7: Hourly auto-update scheduler + manual trigger

**Files:**
- Create: `src/services/autoUpdate.js`
- Modify: `server.js` (start the interval once, after listen), `src/routes/apiRoutes.js` (add `POST /api/admin/run-updates`)
- Test: `src/services/autoUpdate.test.mjs`

**Interfaces:**
- Consumes: `animeForAutoUpdate`, `getEpisodes`, `upsertEpisode` (Task 2b).
- Produces:
  - `runAutoUpdate(db, fetchEpisodes): Promise<{ checked, added }>` — for each `auto_update` anime, calls `fetchEpisodes(anime)` → array of `{ episode_no, title?, server_ids? }`, upserts any whose `number` is not already stored; returns counts. `fetchEpisodes` is injected so the test needs no network.
  - `startScheduler(db, fetchEpisodes, intervalMs=3600000): () => void` — runs on an interval, returns a stop function.

- [ ] **Step 1: Write the failing test**

```js
// src/services/autoUpdate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { openDb } from '../db/db.js';
import { upsertAnime, upsertEpisode } from '../db/library.repo.js';
import { runAutoUpdate } from './autoUpdate.js';

test('runAutoUpdate adds only new episode numbers', async () => {
  const f = path.join(os.tmpdir(), `au-${Date.now()}.db`); const db = openDb(f);
  const id = upsertAnime(db, { title: 'S', anikotoId: 7, slug: 's', autoUpdate: true });
  upsertEpisode(db, id, { number: 1, source: 'anikoto', serverIds: 'a' });
  const fetchEpisodes = async () => [{ episode_no: 1, server_ids: 'a' }, { episode_no: 2, server_ids: 'b' }];
  const r = await runAutoUpdate(db, fetchEpisodes);
  assert.equal(r.checked, 1);
  assert.equal(r.added, 1, 'only episode 2 added');
  db.close(); fs.rmSync(f, { force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/services/autoUpdate.test.mjs`
Expected: FAIL — cannot find `./autoUpdate.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/services/autoUpdate.js
import { animeForAutoUpdate, getEpisodes, upsertEpisode } from '../db/library.repo.js';

export async function runAutoUpdate(db, fetchEpisodes) {
  const list = animeForAutoUpdate(db);
  let added = 0;
  for (const anime of list) {
    const have = new Set(getEpisodes(db, anime.id).map(e => e.number));
    let eps = [];
    try { eps = await fetchEpisodes(anime); } catch { continue; }
    for (const e of eps) {
      const n = Number(e.episode_no);
      if (!have.has(n)) { upsertEpisode(db, anime.id, { number: n, title: e.title || null, sub: 1, serverIds: e.server_ids || null, source: 'anikoto' }); added++; }
    }
  }
  return { checked: list.length, added };
}

export function startScheduler(db, fetchEpisodes, intervalMs = 3600000) {
  const tick = () => runAutoUpdate(db, fetchEpisodes).then(r => {
    if (r.added) console.log(`[AUTO-UPDATE] added ${r.added} episode(s) across ${r.checked} series`);
  }).catch(() => {});
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/services/autoUpdate.test.mjs`
Expected: PASS.

- [ ] **Step 5: Wire the scheduler + manual endpoint**

In `src/routes/apiRoutes.js`, add (using `extractEpisodeList` already imported in Task 5):

```js
  app.post("/api/admin/run-updates", async (req, res) => {
    const { runAutoUpdate } = await import("../services/autoUpdate.js");
    const r = await runAutoUpdate(getDb(), (anime) => extractEpisodeList(anime.slug).then(d => d.episodes || []));
    res.json({ success: true, results: r });
  });
```

In `server.js`, after `app.listen(...)`:

```js
if (process.env.ADMIN_TOKEN && process.env.NODE_ENV !== "test") {
  const { startScheduler } = await import("./src/services/autoUpdate.js");
  const { getDb } = await import("./src/db/index.js");
  const { extractEpisodeList } = await import("./src/extractors/episodeList.extractor.js");
  startScheduler(getDb(), (anime) => extractEpisodeList(anime.slug).then(d => d.episodes || []));
  console.log("[AUTO-UPDATE] hourly scheduler started");
}
```

(Add a `// NOTE: serverless deploys should call POST /api/admin/run-updates from an external cron instead of this in-process timer.` comment above it.)

- [ ] **Step 6: Verify the manual trigger**

```bash
curl -s -H "x-admin-token: devtoken" -X POST "http://localhost:4444/api/admin/run-updates"
```

Expected: `{success:true,results:{checked:N,added:M}}`.

- [ ] **Step 7: Commit**

```bash
git add src/services/autoUpdate.js src/services/autoUpdate.test.mjs src/routes/apiRoutes.js server.js
git commit -m "feat: add hourly auto-update scheduler and manual trigger"
```

---

## Self-Review notes

- **Spec coverage:** §4 model → Task 1; §5 repo → Tasks 2/2b; §6 endpoints → Tasks 3 (auth) + 4 (service) + 5 (routes); §7 admin UI → Task 6; §8 scheduler → Task 7. §9 frontend integration (Phase E) is intentionally deferred to a separate plan (scope check). §11 deps/risks → Task 1 (better-sqlite3), Task 3 (fail-closed), Task 7 (serverless cron note).
- **Extractor export names (confirmed):** `extractAnimeInfo(slug)` in `animeInfo.extractor.js`, `extractEpisodeList(slug)` in `episodeList.extractor.js`, `extractSearchResults(keyword, page)` in `search.extractor.js`, and `resolveStreamUrl(embedUrl)` in `streamResolver.extractor.js` — all verified present, so the imports in Tasks 4–7 are literal.
- **Test isolation:** every DB test uses a temp file and closes/removes it; the singleton `getDb()` is only used by routes/scheduler, never in unit tests.
