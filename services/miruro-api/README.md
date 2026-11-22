# Private MiruroAPI service

Source: MiruroAPI 2.3.3 by Shinei Nouzen (`https://github.com/Shineii86/MiruroAPI`), supplied by the owner through the Google Drive folder referenced in the migration request. Imported helpers/routes retain their MIT attribution; see LICENSE.

Aniyear additions:

- `server.cjs` binds only to 127.0.0.1:4466 and shuts down when the parent disconnects. It does not run the upstream public server, rate limiter, static documentation site or public-facing proxy.
- Dependencies resolve from Aniyear's existing installation. No separate node_modules or copied Git metadata is needed.
- Spotlight metadata requests include a plain-text description for the homepage.
- No paid scraping service, extra credential, or anti-bot solver is configured.
- The main application's `src/services/miruroReleases.js` reads the current Miruro 2.0 homepage release rails from its public SvelteKit JSON feed. It preserves AniList identities, Sub/Dub episode numbers and release timestamps, with 21 entries per page. The older `/recent` metadata collection is not an episode-update feed.
- Release polling shares one request per minute, persists the last valid JSON snapshot across restarts, and backs off failures for one minute. A failed fetch can use a saved snapshot for up to 24 hours; without one it returns a retryable error rather than presenting the legacy catalog as fresh releases. Feed entries do not guarantee that every streaming provider is available.

See `../../docs/MIRURO_ROLLBACK.md` for the provider switch, backup and recovery procedure.
