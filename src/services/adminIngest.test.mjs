import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../db/db.js";
import { getEpisodes, getAnimeByAny } from "../db/library.repo.js";
import { malEmbedUrl, ingestAnikoto, ingestMalEpisode } from "./adminIngest.js";

function tmpDb() {
  const f = path.join(os.tmpdir(), `ing-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = openDb(f);
  return { db, cleanup: () => { db.close(); for (const e of ["", "-wal", "-shm"]) fs.rmSync(f + e, { force: true }); } };
}

test("malEmbedUrl builds the megaplay pattern", () => {
  assert.equal(malEmbedUrl({ source: "mal", id: 21, episode: 3, dub: false }), "https://megaplay.buzz/stream/mal/21/3/sub");
  assert.equal(malEmbedUrl({ source: "anilist", id: 5, episode: 1, dub: true }), "https://megaplay.buzz/stream/ani/5/1/dub");
});

test("ingestAnikoto stores anime and episodes", () => {
  const { db, cleanup } = tmpDb();
  const info = { animeId: 1498, slug: "naruto", title: "Naruto", genres: ["Action"], studios: ["Pierrot"] };
  const episodes = [{ episode_no: 1, title: "A", server_ids: "TOK1" }, { episode_no: 2, server_ids: "TOK2" }];
  const r = ingestAnikoto(db, { info, episodes, sub: true, dub: false, autoUpdate: true });
  assert.equal(r.episodeCount, 2);
  const row = getAnimeByAny(db, { anikotoId: 1498 });
  assert.equal(row.auto_update, 1);
  assert.equal(getEpisodes(db, r.animeId)[0].server_ids, "TOK1");
  cleanup();
});

test("ingestMalEpisode merges one episode by mal id", () => {
  const { db, cleanup } = tmpDb();
  const r = ingestMalEpisode(db, { source: "mal", id: 61316, episode: 1, sub: true, dub: false, embedUrl: "https://megaplay.buzz/stream/mal/61316/1/sub" });
  const eps = getEpisodes(db, r.animeId);
  assert.equal(eps.length, 1);
  assert.equal(eps[0].embed_url, "https://megaplay.buzz/stream/mal/61316/1/sub");
  assert.equal(eps[0].source, "mal");
  cleanup();
});

test("ingestMalEpisode uses catalog meta for title/poster when present", () => {
  const { db, cleanup } = tmpDb();
  const meta = { title: "Real Title", poster: "http://p", synopsis: "syn", status: "Finished", type: "TV" };
  const r = ingestMalEpisode(db, { source: "mal", id: 999, episode: 1, sub: true, embedUrl: "e", meta });
  const a = getAnimeByAny(db, { malId: 999 });
  assert.equal(a.title, "Real Title");
  assert.equal(a.poster, "http://p");
  assert.equal(a.type, "TV");
  cleanup();
});
