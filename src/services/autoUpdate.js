/*
 * AniKotoAPI — autoUpdate.js
 * Adds newly released episodes for series flagged auto_update. `fetchEpisodes`
 * is injected so the core logic is testable without network, and so the
 * scheduler and the manual endpoint share one implementation.
 *
 * @exports runAutoUpdate, startScheduler
 */

import { animeForAutoUpdate, getEpisodes, upsertEpisode } from "../db/library.repo.js";

/**
 * For each auto-update anime, add episode numbers not already stored.
 * @param {import('better-sqlite3').Database} db
 * @param {(anime) => Promise<Array>} fetchEpisodes - returns catalog episodes
 *   `[{number, title?, embed:{sub?,dub?}}]`
 * @returns {Promise<{checked: number, added: number}>}
 */
export async function runAutoUpdate(db, fetchEpisodes) {
  const list = animeForAutoUpdate(db);
  let added = 0;
  for (const anime of list) {
    const have = new Set(getEpisodes(db, anime.id).map(e => e.number));
    let eps = [];
    try { eps = await fetchEpisodes(anime); } catch { continue; }
    for (const e of eps) {
      const n = Number(e.number);
      if (have.has(n)) continue;
      const embed = {};
      if (e.embed?.sub) embed.sub = e.embed.sub;
      if (e.embed?.dub) embed.dub = e.embed.dub;
      if (!embed.sub && !embed.dub) continue;
      upsertEpisode(db, anime.id, {
        number: n, title: e.title || null,
        sub: !!embed.sub, dub: !!embed.dub,
        embedUrl: JSON.stringify(embed), source: "anikoto",
      });
      added++;
    }
  }
  return { checked: list.length, added };
}

/**
 * Runs runAutoUpdate on an interval. Returns a stop function.
 * NOTE: serverless deploys should call POST /api/admin/run-updates from an
 * external cron instead of this in-process timer.
 */
export function startScheduler(db, fetchEpisodes, intervalMs = 3600000) {
  const tick = () => runAutoUpdate(db, fetchEpisodes)
    .then(r => { if (r.added) console.log(`[AUTO-UPDATE] added ${r.added} episode(s) across ${r.checked} series`); })
    .catch(() => {});
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
