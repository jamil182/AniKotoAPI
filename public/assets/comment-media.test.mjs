import { test } from "node:test";
import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import { commentMedia, klipyImageUrl } from "./comment-media-data.js";
import { commentMediaHTML } from "./comment-media-view.js";
import { klipyItem, searchMedia, mediaItems } from "./comment-media-api.js";
import { commentHTML, commentShell } from "./comments-view.js";

const media = {
  provider: "klipy",
  kind: "gif",
  slug: "luffy-laugh",
  title: "Luffy",
};
const cdn =
  "https://static.klipy.com/ii/example/one.webp?source=search&tracking=original";
const record = (slug = "luffy-laugh", type = "gif") => ({
  slug,
  title: "Luffy",
  type,
  file: {
    md: { webp: { url: cdn, width: 400, height: 300, size: 50000 } },
    xs: { webp: { url: cdn, width: 100, height: 75, size: 4000 } },
  },
});

test("only provider references are accepted, and original HTTPS media URLs preserve query delivery data", () => {
  assert.deepEqual(commentMedia(media), media);
  for (const value of [
    { ...media, url: cdn },
    { ...media, kind: "html" },
    { ...media, slug: 'x" onerror="bad' },
    null,
    [],
    { ...media, kind: { toString: "gif" } },
  ])
    assert.equal(commentMedia(value), null);
  assert.equal(klipyImageUrl(cdn), cdn);
  assert.ok(klipyImageUrl("https://static2.klipy.com/a.gif"));
  for (const url of [
    "javascript:alert(1)",
    "data:image/png;base64,abc",
    "https://evil.example/x.gif",
    "https://static.klipy.com.evil.example/x.gif",
    "https://user:pass@static.klipy.com/x.gif",
    "https://static.klipy.com:8443/x.gif",
    "http://static.klipy.com/a.gif",
    "https://static.klipy.com/a.svg",
    "https://static.klipy.com/a.gif\n",
  ])
    assert.equal(klipyImageUrl(url), null);
});

test("media rendering escapes captions, leaves HTML inert and includes attachments within episode spoilers", () => {
  const item = {
    id: 1,
    episode: 1,
    parentId: null,
    author: "User",
    body: "<img src=x onerror=bad()>",
    media: { ...media, title: '<svg onload="bad()">' },
    spoiler: true,
    createdAt: 0,
    deleted: false,
    likes: 0,
    liked: false,
    canDelete: false,
    replyCount: 0,
  };
  const $ = cheerio.load(
    commentHTML(item, { watchEpisode: 1, signedIn: false }),
  );
  assert.equal($("img,svg,script").length, 0);
  assert.equal($("details .comment-media").length, 1);
  assert.equal($("figcaption").text(), item.media.title);
  assert.equal(commentMediaHTML({ ...media, url: cdn }), "");
  const deleted = cheerio.load(
    commentHTML({ ...item, deleted: true, media: null }, { watchEpisode: 1 }),
  );
  assert.equal(deleted(".comment-media").length, 0);
  const shell = cheerio.load(commentShell());
  assert.equal(shell("[data-media-toggle][disabled]").length, 1);
  assert.equal(shell(".comment-editor-actions [data-emoji-toggle]").length, 1);
});

test("KLIPY variant parsing validates delivery hosts, file formats, content types and dimensions", () => {
  const parsed = klipyItem(record(), "gif");
  assert.deepEqual(parsed.media, media);
  assert.equal(parsed.url, cdn);
  assert.equal(parsed.width, 400);
  assert.equal(
    klipyItem(record("anime-meme", "static-meme"), "image").media.kind,
    "image",
  );
  for (const row of [
    { ...record(), type: "ad" },
    {
      ...record(),
      file: { md: { webp: { url: "https://evil.example/x.webp" } } },
    },
    { ...record(), file: {} },
    null,
  ])
    assert.throws(() => klipyItem(row, "gif"));
});

test("search uses direct client requests, high content filtering and provider pagination without caching or changing order", async (t) => {
  const documentBefore = globalThis.document;
  globalThis.document = { documentElement: { lang: "en" } };
  t.after(() => {
    if (documentBefore === undefined) delete globalThis.document;
    else globalThis.document = documentBefore;
  });
  const sent = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    sent.push({ url: String(url), options });
    if (String(url) === "/api/comments/media-config")
      return Response.json({
        success: true,
        results: {
          enabled: true,
          provider: "klipy",
          publicApiKey: "public_fixture_key",
        },
      });
    const type = String(url).includes("static-memes") ? "static-meme" : "gif";
    return Response.json({
      result: true,
      data: {
        data: [record("second", type), record("first", type)],
        current_page: 2,
        has_next: true,
      },
    });
  });
  const page = await searchMedia(
    "gif",
    "one piece & friends",
    2,
    new AbortController().signal,
  );
  assert.deepEqual(
    page.items.map((item) => item.media.slug),
    ["second", "first"],
  );
  assert.equal(page.page, 2);
  assert.equal(page.hasNext, true);
  const call = sent[1],
    url = new URL(call.url);
  assert.equal(url.origin, "https://api.klipy.com");
  assert.match(url.pathname, /\/gifs\/search$/);
  assert.equal(url.searchParams.get("q"), "one piece & friends");
  assert.equal(url.searchParams.get("content_filter"), "high");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(call.options.credentials, "omit");
  assert.equal(call.options.cache, "no-store");
  assert.ok(!url.searchParams.has("customer_id"));
  await searchMedia("image", "", 1, new AbortController().signal);
  assert.match(new URL(sent.at(-1).url).pathname, /\/static-memes\/trending$/);
  globalThis.fetch.mock.mockImplementation(async () =>
    Response.json({
      result: true,
      data: { data: [record(), { ...record(), type: "ad" }] },
    }),
  );
  await assert.rejects(
    searchMedia("gif", "test", 1, new AbortController().signal),
    /unavailable/,
  );
  globalThis.fetch.mock.mockImplementation(
    async () => new Response("not JSON", { status: 429 }),
  );
  await assert.rejects(
    searchMedia("gif", "test", 1, new AbortController().signal),
    /limit reached/,
  );
  for (const [kind, query, page] of [
    ["gif", "x", 0],
    ["video", "x", 1],
    ["gif", "x".repeat(81), 1],
    ["gif", "x\u0000", 1],
  ])
    assert.throws(() =>
      searchMedia(kind, query, page, new AbortController().signal),
    );
  assert.throws(() => mediaItems("gif", ["../../private"]));
  assert.throws(() => mediaItems("gif", []));
  const aborted = new AbortController();
  aborted.abort();
  globalThis.fetch.mock.mockImplementation(async (url, options) => {
    options.signal.throwIfAborted();
  });
  await assert.rejects(
    searchMedia("gif", "test", 1, aborted.signal),
    (error) => error.name === "AbortError",
  );
});

test("missing public App Key disables provider requests, and malformed configuration can recover", async (t) => {
  const disabled = await import(
    "./comment-media-api.js?configuration-disabled"
  );
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({
      success: true,
      results: { enabled: false, provider: "klipy", publicApiKey: "" },
    });
  });
  await assert.rejects(disabled.mediaItems("gif", ["test"]), /not enabled/);
  assert.equal(calls, 1);
  const recover = await import("./comment-media-api.js?configuration-recovery");
  globalThis.fetch.mock.mockImplementation(
    async () => new Response("broken", { status: 502 }),
  );
  await assert.rejects(recover.mediaConfiguration());
  globalThis.fetch.mock.mockImplementation(async () =>
    Response.json({
      success: true,
      results: {
        enabled: true,
        provider: "klipy",
        publicApiKey: "public_fixture_key",
      },
    }),
  );
  assert.equal((await recover.mediaConfiguration()).enabled, true);
});
