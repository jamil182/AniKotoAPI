import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "./db.js";
import {
  upsertAnime, getAnimeByAny, upsertEpisode, getEpisodes, listAnime, deleteAnime,
} from "./library.repo.js";

function tmpDb() {
  const file = path.join(os.tmpdir(), `anikoto-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = openDb(file);
  return {
    db,
    cleanup: () => {
      db.close();
      for (const ext of ["", "-wal", "-shm"]) fs.rmSync(file + ext, { force: true });
    },
  };
}

test("upsertAnime inserts then merges by mal_id without duplicating", () => {
  const { db, cleanup } = tmpDb();
  const id1 = upsertAnime(db, { malId: 21, title: "One Piece", type: "TV" });
  const id2 = upsertAnime(db, { malId: 21, title: "One Piece", status: "Airing" });
  assert.equal(id1, id2, "same row reused on matching mal_id");
  const row = getAnimeByAny(db, { malId: 21 });
  assert.equal(row.type, "TV", "first non-null field kept");
  assert.equal(row.status, "Airing", "later field filled in");
  const count = db.prepare("SELECT COUNT(*) c FROM anime").get().c;
  assert.equal(count, 1, "no duplicate");
  cleanup();
});

test("upsertEpisode inserts then updates by (anime_id, number)", () => {
  const { db, cleanup } = tmpDb();
  const id = upsertAnime(db, { title: "Test", malId: 99 });
  upsertEpisode(db, id, { number: 1, sub: true, source: "mal", embedUrl: "x" });
  upsertEpisode(db, id, { number: 1, dub: true, source: "mal", embedUrl: "y" });
  const eps = getEpisodes(db, id);
  assert.equal(eps.length, 1, "no duplicate episode");
  assert.equal(eps[0].embed_url, "y", "updated in place");
  assert.equal(eps[0].dub, 1);
  cleanup();
});

test("deleteAnime cascades to episodes", () => {
  const { db, cleanup } = tmpDb();
  const id = upsertAnime(db, { title: "Gone", malId: 5 });
  upsertEpisode(db, id, { number: 1, source: "mal" });
  deleteAnime(db, id);
  assert.equal(listAnime(db).length, 0);
  assert.equal(getEpisodes(db, id).length, 0, "episodes cascade-deleted");
  cleanup();
});
