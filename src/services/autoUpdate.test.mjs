import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../db/db.js";
import { upsertAnime, upsertEpisode } from "../db/library.repo.js";
import { runAutoUpdate } from "./autoUpdate.js";

test("runAutoUpdate adds only new episode numbers", async () => {
  const f = path.join(os.tmpdir(), `au-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = openDb(f);
  const id = upsertAnime(db, { title: "S", anikotoId: 7, slug: "s", autoUpdate: true });
  upsertEpisode(db, id, { number: 1, source: "anikoto", embedUrl: JSON.stringify({ sub: "a" }) });
  const fetchEpisodes = async () => [
    { number: 1, embed: { sub: "a" } },
    { number: 2, embed: { sub: "b" } },
  ];
  const r = await runAutoUpdate(db, fetchEpisodes);
  assert.equal(r.checked, 1);
  assert.equal(r.added, 1, "only episode 2 added");
  db.close();
  for (const e of ["", "-wal", "-shm"]) fs.rmSync(f + e, { force: true });
});
