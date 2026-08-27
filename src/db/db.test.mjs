import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "./db.js";

test("openDb creates anime and episode tables", () => {
  const file = path.join(os.tmpdir(), `anikoto-test-${Date.now()}.db`);
  const db = openDb(file);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  assert.ok(tables.includes("anime"), "anime table exists");
  assert.ok(tables.includes("episode"), "episode table exists");
  db.close();
  fs.rmSync(file, { force: true });
  fs.rmSync(file + "-wal", { force: true });
  fs.rmSync(file + "-shm", { force: true });
});
