# Private MiruroAPI service

Source: MiruroAPI 2.3.3 by Shinei Nouzen (`https://github.com/Shineii86/MiruroAPI`), supplied by the owner through the Google Drive folder referenced in the migration request. Imported helpers/routes retain their MIT attribution; see LICENSE.

Aniyear additions:

- `server.cjs` binds only to 127.0.0.1:4466 and shuts down when the parent disconnects. It does not run the upstream public server, rate limiter, static documentation site or public-facing proxy.
- Dependencies resolve from Aniyear's existing installation. No separate node_modules or copied Git metadata is needed.
- Spotlight metadata requests include a plain-text description for the homepage.
- No paid scraping service, extra credential, or anti-bot solver is configured.

See `../../docs/MIRURO_ROLLBACK.md` for the provider switch, backup and recovery procedure.
