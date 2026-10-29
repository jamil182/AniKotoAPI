import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("./realtime.js", import.meta.url), "utf8");
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function harness() {
  let timerId = 0;
  const timers = new Map();
  const document = new EventTarget();
  const window = new EventTarget();
  const status = { dataset: {} };
  document.hidden = false;
  document.getElementById = () => status;
  const context = {
    document, window, AbortController, Date,
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
  };
  runInNewContext(source, context);
  return {
    start: context.startLiveRefresh, document, window, timers, status,
    fire: () => { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.fn(); },
  };
}

test("polls after completion, never overlaps, and cancels on stop", async () => {
  const h = harness();
  let complete;
  let calls = 0;
  let signal;
  const values = [];
  const stop = h.start(s => { calls++; signal = s; return new Promise(resolve => { complete = resolve; }); }, { onData: value => values.push(value) });
  assert.equal(calls, 1);
  assert.equal(h.timers.size, 0);
  complete("new data");
  await flush();
  assert.deepEqual(values, ["new data"]);
  assert.equal([...h.timers.values()][0].delay, 30000);
  h.fire();
  assert.equal(calls, 2);
  stop();
  assert.equal(signal.aborted, true);
  complete("late response");
  await flush();
  assert.deepEqual(values, ["new data"]);
  assert.equal(h.timers.size, 0);
});

test("keeps previous data after failure and obeys Retry-After with backoff", async () => {
  const h = harness();
  let calls = 0;
  const values = [];
  const errors = [];
  const stop = h.start(async () => {
    if (++calls > 1) throw Object.assign(new Error("rate limited"), { retryAfter: 90 });
    return "last good data";
  }, { onData: value => values.push(value), onError: error => errors.push(error) });
  await flush();
  h.fire();
  await flush();
  assert.deepEqual(values, ["last good data"]);
  assert.equal(errors.length, 1);
  assert.equal(h.status.dataset.state, "stale");
  assert.equal([...h.timers.values()][0].delay, 90000);
  stop();
});

test("pauses while hidden and refreshes when visible", async () => {
  const h = harness();
  let calls = 0;
  const stop = h.start(async () => ++calls, { onData: () => {} });
  await flush();
  h.document.hidden = true;
  h.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(h.timers.size, 0);
  assert.equal(h.status.dataset.state, "paused");
  h.document.hidden = false;
  h.document.dispatchEvent(new Event("visibilitychange"));
  await flush();
  assert.equal(calls, 2);
  stop();
});

test("hiding a tab aborts its request and discards the late result", async () => {
  const h = harness();
  let signal;
  let resolve;
  let rendered = false;
  const stop = h.start(s => { signal = s; return new Promise(done => { resolve = done; }); }, { onData: () => { rendered = true; } });
  h.document.hidden = true;
  h.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(signal.aborted, true);
  resolve("late data");
  await flush();
  assert.equal(rendered, false);
  assert.equal(h.timers.size, 0);
  stop();
});

test("aborts hidden requests and restarts after back-forward cache restore", async () => {
  const h = harness();
  let signal;
  let calls = 0;
  const stop = h.start(async s => { signal = s; calls++; return calls; }, { onData: () => {} });
  await flush();
  h.window.dispatchEvent(new Event("pagehide"));
  assert.equal(h.timers.size, 0);
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  h.window.dispatchEvent(event);
  await flush();
  assert.equal(calls, 2);
  assert.equal(signal.aborted, false);
  stop();
});
