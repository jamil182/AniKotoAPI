import { test } from "node:test";
import assert from "node:assert/strict";
import { adminAuth } from "./adminAuth.js";

function run(headers, envToken) {
  const prev = process.env.ADMIN_TOKEN;
  if (envToken === undefined) delete process.env.ADMIN_TOKEN; else process.env.ADMIN_TOKEN = envToken;
  let status = 200, nexted = false;
  const req = { get: (h) => headers[h.toLowerCase()], query: {} };
  const res = { status(c) { status = c; return this; }, json() { return this; } };
  adminAuth(req, res, () => { nexted = true; });
  if (prev === undefined) delete process.env.ADMIN_TOKEN; else process.env.ADMIN_TOKEN = prev;
  return { status, nexted };
}

test("adminAuth fails closed when token unset", () => {
  assert.equal(run({}, undefined).status, 503);
});

test("adminAuth 401 on wrong token", () => {
  assert.equal(run({ "x-admin-token": "nope" }, "secret").status, 401);
});

test("adminAuth passes on correct token", () => {
  const r = run({ "x-admin-token": "secret" }, "secret");
  assert.equal(r.nexted, true);
});
