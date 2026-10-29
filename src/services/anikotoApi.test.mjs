import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAniKotoClient, normalizeList } from "./anikotoApi.js";
import { createCatalogRouter } from "../routes/catalog.route.js";

const response = results => ({ data: { success: true, results } });

test("normalizes slugs, names and duplicates without inventing internal library IDs", () => {
  assert.deepEqual(normalizeList({ data: [
    { slug: "naruto-eybxz/ep-1", name: "Naruto", japaneseTitle: "ナルト" },
    { slug: "naruto-eybxz/ep-2", title: "Naruto" },
    { slug: "https://evil.example/watch/x", title: "Bad" },
    null,
  ] }), [{
    slug: "naruto-eybxz", id: "naruto-eybxz", name: "Naruto", title: "Naruto",
    japaneseTitle: "ナルト", japanese_title: "ナルト", genres: [],
  }]);
});

test("deduplicates concurrent requests, expires cache and caps entries", async () => {
  let calls = 0;
  let time = 0;
  const client = createAniKotoClient({
    ttlMs: 30000, maxEntries: 2, now: () => time,
    request: async () => { calls++; return response({ calls }); },
  });
  const [a, b] = await Promise.all([client.get("/search", { keyword: "a" }), client.get("/search", { keyword: "a" })]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  await client.get("/search", { keyword: "a" });
  assert.equal(calls, 1);
  time = 30001;
  await client.get("/search", { keyword: "a" });
  assert.equal(calls, 2);
  await client.get("/search", { keyword: "b" });
  await client.get("/search", { keyword: "c" });
  await client.get("/search", { keyword: "a" });
  assert.equal(calls, 5, "oldest entry was evicted");
});

test("rejects unexpected upstream payloads and retries failed requests", async () => {
  let calls = 0;
  const client = createAniKotoClient({ request: async () => ++calls === 1 ? { data: "<html>blocked</html>" } : response([]) });
  await assert.rejects(client.get("/trending"), /invalid or unsuccessful/);
  assert.deepEqual(await client.get("/trending"), []);
  assert.equal(calls, 2);
});

test("maps upstream throttling, timeout and missing anime to useful statuses", async () => {
  for (const [failure, expectedStatus, retryAfter] of [
    [{ response: { status: 429, headers: { "retry-after": "60" } } }, 429, "60"],
    [{ code: "ECONNABORTED" }, 504, null],
    [{ response: { status: 404 } }, 404, null],
    [new Error("secret internal hostname"), 502, null],
  ]) {
    const client = createAniKotoClient({ request: async () => { throw failure; } });
    await assert.rejects(client.get("/"), error => {
      assert.equal(error.status, expectedStatus);
      assert.equal(error.retryAfter, retryAfter);
      assert.ok(!error.message.includes("secret"));
      return true;
    });
  }
});

test("home retains real day/week/month rankings and degrades optional sections", async () => {
  const client = createAniKotoClient({ request: async url => {
    const endpoint = new URL(url).pathname;
    if (endpoint.endsWith("top-ten")) return response({ today: [{ slug: "day", name: "Day" }], week: [{ slug: "week", name: "Week" }], month: [] });
    if (endpoint.endsWith("most-popular")) throw new Error("temporary failure");
    return response({ spotlights: [], trending: [{ slug: "latest/ep-4", title: "Latest" }], topAiring: [{ slug: "fallback" }], genres: ["Action"] });
  } });
  const home = await client.home();
  assert.equal(home.latest[0].id, "latest");
  assert.equal(home.rankings.today[0].id, "day");
  assert.equal(home.rankings.week[0].id, "week");
  assert.deepEqual(home.rankings.month, []);
  assert.equal(home.popular[0].id, "fallback");
});

test("only explicit API paths can be requested and operator URL must be HTTPS", async () => {
  assert.throws(() => createAniKotoClient({ baseUrl: "http://example.com/api" }), /HTTPS/);
  assert.throws(() => createAniKotoClient({ baseUrl: "https://user:password@example.com/api" }), /credentials/);
  const client = createAniKotoClient({ request: async () => { assert.fail("must not make a request"); } });
  for (const endpoint of ["//evil.example/", "/../admin", "/stream/proxy", "/episodes/a?url=evil", '/type/private', '/status/private']) {
    await assert.rejects(client.get(endpoint), /Unsupported/);
  }
});

test("catalog routes validate inputs, preserve upstream IDs and disable browser caching", async t => {
  const calls = [];
  const app = express();
  app.use("/api/catalog", createCatalogRouter({
    home: async () => ({ latest: [{ slug: "fallback-anime", title: "Fallback" }] }),
    get: async (endpoint, params) => {
      calls.push({ endpoint, params });
      if (endpoint === "/random") return { slug: "https://anikototv.to/random" };
      if (endpoint.startsWith("/episodes/")) return { episodes: [{ episode_no: 1, server_ids: "encoded-token" }, { episode_no: -1 }] };
      if (endpoint === "/servers") return [{ link_id: "server-token", type: "sub" }];
      if (endpoint === "/stream") return { url: params.id === "bad-token" ? "https://evil.example/stream/test" : "https://vidtube.site/stream/test" };
      return { data: [{ slug: "naruto-eybxz/ep-1", title: "Naruto" }], totalPages: 3 };
    },
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/catalog`;
  for (const endpoint of ["/search?keyword[x]=bad", "/anime/bad%2Fslug", "/browse?page=-1", "/browse?source=unknown", "/browse?source[]=latest", "/watch?slug=naruto&ep=nan", "/servers?ids=token&slug=../x", "/browse?letter=abc", "/embeds?slug=naruto&ep=-1", "/embeds?slug[]=bad&ep=1"]) {
    const res = await fetch(base + endpoint);
    assert.equal(res.status, 400, endpoint);
  }
  assert.equal(calls.length, 0);
  const res = await fetch(base + "/search?keyword=naruto");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal((await res.json()).results.data[0].id, "naruto-eybxz");
  const episodes = await (await fetch(base + "/episodes/naruto-eybxz")).json();
  assert.equal(episodes.results.totalEpisodes, 1);
  assert.equal(episodes.results.episodes[0].server_ids, "encoded-token");
  const servers = await (await fetch(base + "/servers?ids=encoded-token&slug=naruto-eybxz")).json();
  assert.equal(servers.results[0].link_id, "server-token");
  await fetch(base + "/browse?genre=action&page=2");
  assert.deepEqual(calls.at(-1), { endpoint: "/genre/action", params: { page: "2" } });
  const random = await (await fetch(base + "/random")).json();
  assert.equal(random.results.id, "fallback-anime", "invalid upstream random slug falls back to a valid catalog entry");
  const embeds = await (await fetch(base + "/embeds?slug=naruto-eybxz&ep=1")).json();
  assert.equal(embeds.results.sources[0].linkId, "server-token");
  const embed = await (await fetch(base + "/embed?slug=naruto-eybxz&id=server-token")).json();
  assert.equal(embed.results.url, "https://vidtube.site/stream/test");
  assert.equal((await fetch(base + "/embed?slug=naruto-eybxz&id=bad-token")).status, 502);
});

test('catalog pages forward real page numbers, normalize array feeds and reject invalid upstream pagination', async t => {
  const calls = [];
  let invalid = false;
  const app = express();
  app.use('/catalog', createCatalogRouter({ get: async (endpoint, params) => {
    calls.push({ endpoint, params });
    if (invalid) return { data: [], totalPages: -1 };
    if (endpoint === '/trending') return [{ slug: 'trending-one', title: 'Trending' }];
    return { data: [{ slug: `page-${params.page}`, title: 'Page ' + params.page }], pagination: { totalPages: 301 } };
  } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/catalog`;
  const page = await (await fetch(base + '/browse?page=2')).json();
  assert.equal(page.results.data[0].id, 'page-2');
  assert.equal(page.results.totalPages, 301);
  assert.deepEqual(calls.at(-1), { endpoint: '/latest-updated', params: { page: '2' } });
  const trending = await (await fetch(base + '/browse?source=trending')).json();
  assert.equal(trending.results.data[0].id, 'trending-one');
  assert.equal(trending.results.totalPages, 1);
  invalid = true;
  assert.equal((await fetch(base + '/browse')).status, 502);
});

test('menu categories forward to their matching paginated API endpoints', async t => {
  const calls = [];
  const app = express();
  app.use('/catalog', createCatalogRouter({ get: async (endpoint, params) => {
    calls.push({ endpoint, params });
    return { data: [{ slug: 'category-entry', title: endpoint }], totalPages: 3 };
  } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/catalog/browse`;
  for (const [query, endpoint] of [
    ['source=added', '/newly-added'], ['source=popular', '/most-popular'],
    ['source=upcoming', '/status/upcoming'], ['source=ongoing', '/status/ongoing'],
    ['source=completed', '/status/completed'], ['type=tv', '/type/tv'], ['type=movie', '/type/movie'],
  ]) {
    const result = await fetch(base + '?' + query + '&page=2');
    assert.equal(result.status, 200);
    assert.deepEqual(calls.at(-1), { endpoint, params: { page: '2' } });
    assert.equal((await result.json()).results.totalPages, 3);
  }
  for (const query of ['type=../admin', 'type[]=tv', 'source=__proto__']) assert.equal((await fetch(base + '?' + query)).status, 400);
});
