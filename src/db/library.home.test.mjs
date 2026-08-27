import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "./db.js";
import { upsertAnime, homeSections, searchAnime } from "./library.repo.js";

test("homeSections and searchAnime read stored anime", () => {
  const f = path.join(os.tmpdir(), `home-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = openDb(f);
  upsertAnime(db, { title: "Bleach", malId: 1, rating: "8.9", genres: ["Action"], poster: "p" });
  upsertAnime(db, { title: "Naruto", malId: 2, rating: "8.1", genres: ["Action", "Shounen"], poster: "q" });
  const h = homeSections(db);
  assert.equal(h.latest.length, 2);
  assert.equal(h.top[0].rating, "8.9", "top sorted by rating desc");
  assert.ok(h.genres.includes("Shounen"), "genres aggregated");
  assert.equal(searchAnime(db, "naru")[0].title, "Naruto");
  db.close();
  for (const e of ["", "-wal", "-shm"]) fs.rmSync(f + e, { force: true });
});
