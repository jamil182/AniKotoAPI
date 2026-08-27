# AniKoto CMS — Design Spec

Date: 2026-08-27
Status: Approved design, pending spec review
Branch: claude/localhost-testing-ec34f7

## 1. Purpose

Add an admin CMS to the project so anime can be **fetched once and stored**,
instead of scraping the upstream source live on every request. Two ingest
paths, matching the reference admin UI:

1. **Fetch Anikoto** — search a title, pick it, and store the full series
   (metadata, artwork, episode list) by its Anikoto Series ID.
2. **Fetch MAL/AniList Episode** — add a single episode by MAL or AniList ID,
   merged into the matching stored anime.

The stored library then becomes the content source for the AniJs frontend:
the homepage, detail, and watch pages read from the database rather than
live-scraping. Streams are still resolved live at watch time.

## 2. Scope

In scope:
- SQLite storage layer and data model.
- Admin ingest endpoints, protected by an admin token.
- Admin UI page (`/admin`) with the two ingest panels.
- Hourly scheduler that adds newly released episodes for flagged series.
- Frontend switch to serve from the library.

Out of scope (documented, not built):
- A production-grade deployment story for the stateful DB (SQLite does not
  persist on Vercel serverless; localhost is the primary target here).
- A full user/account system — a single shared admin token is the auth.
- Editing/curation UI beyond fetch, list, and delete.

## 3. Decisions (locked)

| Decision | Choice |
| --- | --- |
| Storage | SQLite via `better-sqlite3`, file at `data/anikoto.db` |
| Frontend source | AniJs pages read from the stored library |
| Admin auth | `ADMIN_TOKEN` in `.env`, sent as `x-admin-token` header |
| Stream resolution | Still live at watch time (verified: MAL embeds resolve) |

## 4. Data model

SQLite, created idempotently on startup (`CREATE TABLE IF NOT EXISTS`).

### `anime`
| column | type | notes |
| --- | --- | --- |
| id | INTEGER PK | internal id |
| anikoto_id | INTEGER | Anikoto Series ID (`animeId`); nullable |
| mal_id | INTEGER | nullable |
| anilist_id | INTEGER | nullable |
| slug | TEXT | Anikoto slug; nullable |
| title | TEXT | required |
| japanese_title | TEXT | |
| poster | TEXT | |
| banner | TEXT | |
| synopsis | TEXT | |
| type | TEXT | |
| status | TEXT | |
| genres | TEXT | JSON array |
| studios | TEXT | JSON array |
| rating | TEXT | |
| total_episodes | INTEGER | |
| auto_update | INTEGER | 0/1 |
| created_at | TEXT | ISO |
| updated_at | TEXT | ISO |

Indexes / uniqueness for merge: unique on `anikoto_id`, `mal_id`, `anilist_id`
(each where not null). Merge resolution order: anikoto_id → mal_id →
anilist_id → case-insensitive title.

### `episode`
| column | type | notes |
| --- | --- | --- |
| id | INTEGER PK | |
| anime_id | INTEGER FK → anime.id | |
| number | INTEGER | episode number |
| title | TEXT | |
| sub | INTEGER | 0/1 |
| dub | INTEGER | 0/1 |
| server_ids | TEXT | Anikoto opaque token (Anikoto-sourced) |
| embed_url | TEXT | megaplay embed URL (MAL/AniList-sourced) |
| source | TEXT | 'anikoto' \| 'mal' \| 'anilist' |
| created_at | TEXT | |
| updated_at | TEXT | |

Unique on `(anime_id, number)`. Upsert on conflict.

## 5. Storage layer — `src/db/`

- `db.js` — opens the SQLite file (creating `data/` if missing), enables WAL,
  runs migrations. Exports the connection.
- `library.repo.js` — pure data access, no HTTP:
  - `upsertAnime(record)` → resolves an existing row by the merge order above,
    updates it, or inserts; returns the row id.
  - `upsertEpisode(animeId, episode)` → insert or update by `(anime_id, number)`.
  - `listAnime({limit, offset})`, `getAnimeById(id)`, `getAnimeByAny({anikotoId,
    malId, anilistId, title})`, `getEpisodes(animeId)`, `deleteAnime(id)`.
  - `animeForAutoUpdate()` → rows with `auto_update = 1`.

## 6. Admin endpoints

All under `/api/admin/*`, gated by an auth middleware:
- Reads `x-admin-token` (or `?token=`) and compares to `process.env.ADMIN_TOKEN`.
- If `ADMIN_TOKEN` is unset → 503 (fail closed, so an unconfigured deploy never
  exposes admin writes).
- If token missing/wrong → 401.

Endpoints:
- `GET /api/admin/search?keyword=` — thin pass-through to the existing search,
  returning `{ animeId, slug, title, poster, type, sub, dub }` for the picker.
- `POST /api/admin/fetch-anikoto` — body `{ slug, sub, dub, autoUpdate }`.
  NOTE: the reference UI labels a numeric "Series ID" (e.g. 1498 = `animeId`),
  but the project's `/info` and `/episodes` are keyed by the Anikoto **slug**,
  not that number. The picker therefore carries the slug (hidden) and displays
  `animeId` as the "Series ID" for parity; this endpoint drives off the slug and
  stores `animeId` in `anime.anikoto_id`. Fetches `/info` + `/episodes`, upserts
  the anime and every episode (with `server_ids`, `source:'anikoto'`), sets
  `auto_update`. Returns the stored anime + episode count.
- `POST /api/admin/fetch-mal` — body `{ source:'mal'|'anilist', id, episode,
  sub, dub }`. Builds `https://megaplay.buzz/stream/{source}/{id}/{episode}/{sub|dub}`,
  resolves it to confirm it plays, then upserts/merges into the matching anime
  (by mal/anilist id; if none, creates a minimal record) and stores the episode
  with `embed_url` and `source`. Returns the preview URL + stored record.
- `GET /api/admin/library` — list stored anime for management.
- `DELETE /api/admin/anime/:id` — remove an anime and its episodes.

The rate-limiter already exempts media proxies; admin routes stay rate-limited.

## 7. Admin UI — `/admin`

Route serves `public/admin.html`, gated by the same token (the page prompts for
the token once and stores it in `localStorage`, sending it as `x-admin-token`).
Layout mirrors the reference:

- **Panel 1 — Fetch Anikoto**: search box → results list with Select → Series ID
  field showing `animeId` (display only; the slug is carried through hidden for
  the fetch) → SUB/DUB checkboxes → "Automatic episode updates" toggle → "Fetch
  Anikoto" button → status/result line.
- **Panel 2 — Fetch MAL/AniList Episode**: Source dropdown (MAL / AniList) → ID
  field + Episode number → SUB/DUB → a live preview of the megaplay URL that
  will be used → "Fetch MAL/AniList Episode" button → status/result.

Built with the existing vanilla + `app.css` design system, dark theme.

## 8. Scheduler

On server start (guarded to run once), an hourly `setInterval` iterates
`animeForAutoUpdate()`; for each, re-fetches the Anikoto episode list and
`upsertEpisode`s any new numbers, logging additions. A comment documents that
serverless deployments must drive this via an external cron hitting an
`/api/admin/run-updates` endpoint instead of the in-process timer.

## 9. Frontend integration (library-backed)

New serving endpoints read from SQLite (no scraping):
- `GET /api/library/home` — spotlights / latest / top derived from stored anime.
- `GET /api/library/anime/:id` — one anime's metadata.
- `GET /api/library/episodes/:id` — its episodes.

AniJs pages switch their data source from the live `/api/*` to `/api/library/*`.
The watch page still resolves streams live: for `source:'anikoto'` episodes via
`server_ids` → `/servers` → `/stream/resolve`; for `source:'mal'|'anilist'`
episodes by resolving the stored `embed_url` directly (a new
`/api/stream/resolve-url?url=` that guards + calls `resolveStreamUrl`).

This is the largest sub-phase and touches `index.html`, `anime.html`,
`watch.html`, and `api.js` (its `apiGet` base and the loaders).

## 10. Build phases

Each phase is verified before the next begins.

- **A. Storage** — `src/db/` + model + migrations; unit-test upsert/merge.
- **B. Admin endpoints** — auth middleware + fetch-anikoto + fetch-mal +
  library/delete; verified end to end against the running server.
- **C. Admin UI** — `/admin` page; verified in-browser (search → fetch → row
  appears in library).
- **D. Scheduler** — hourly job + manual `run-updates` endpoint; verified by
  flagging a series and confirming new episodes are added.
- **E. Frontend integration** — `/api/library/*` + switch AniJs pages;
  `resolve-url` for MAL episodes; verified in-browser across all pages.

## 11. Dependencies, risks, and mitigations

- **`better-sqlite3`** — native module; compiles or uses a prebuilt binary on
  install. Risk on Windows if no prebuilt matches Node; mitigation: it ships
  prebuilds for current Node LTS, and the project already runs Node 24.
- **Stateful deployment** — SQLite will not persist on Vercel serverless. This
  is documented; localhost is the target. A production path would move the DB
  to a hosted engine behind the same `library.repo.js` interface.
- **Fail-closed admin** — with `ADMIN_TOKEN` unset, admin routes 503, so an
  accidentally-public instance cannot be written to.
- **Copyright/nature** — the CMS stores references (ids, tokens, embed URLs) to
  the same upstream streams the project already scrapes; no media is copied.

## 12. Success criteria

- Fetch Anikoto stores a series and its episodes; re-fetching merges, not
  duplicates.
- Fetch MAL/AniList adds one episode, merged into the matching anime.
- The admin page is unreachable without the token.
- With the library populated, AniJs homepage/detail/watch render from the DB,
  and a stored episode plays.
- A flagged series gains new episodes on the hourly run.
