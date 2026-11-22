# Miruro integration and rollback

Aniyear can switch catalogs and appearance independently. Both settings are server-side configuration; no account, comment, translation or visitor database is replaced.

## Enable

Run from `/www/wwwroot/anikoto-app` with the application file owner's permissions:

```sh
node scripts/set-catalog-provider.mjs miruro miruro
```

Restart **anijs** in aaPanel → Website → Node.js Project → anijs → Service status. The application starts its private MiruroAPI 2.3.3 service on **127.0.0.1:4466**. It is not exposed through Nginx or the firewall. Its dependencies are the existing Express/Axios dependencies in the parent project. The independent JSmovies service on port **4444** is unchanged.

## Return to the previous appearance and catalog

```sh
cd /www/wwwroot/anikoto-app
node scripts/set-catalog-provider.mjs anikoto classic
```

Restart **anijs** in the same aaPanel screen. This stops the child Miruro service and restores the AniKoto catalog and classic layout. New accounts and comments remain intact. To change only the appearance, use `miruro classic` instead.

## Full recovery snapshot

Before deployment, the server snapshot is stored in `/www/backup/aniyear-before-miruro/<timestamp>/`:

- `application.tar.gz`: original application files and production branding/customizations, excluding installed dependencies, Git internals and the data directory.
- `environment.env`: original private environment configuration.
- `anikoto.db`: consistent SQLite backup made with the SQLite backup API while the application is running.
- `commit.txt`, `git-status.txt`, `SHA256SUMS`: source version and checksums.

Keep this directory private. It contains credentials and user data. Prefer the configuration switch above for normal rollback. Full recovery of source files can be performed from aaPanel Terminal after stopping only **anijs**:

```sh
cd /www/backup/aniyear-before-miruro/REPLACE_WITH_BACKUP_TIMESTAMP
sha256sum -c SHA256SUMS
tar -xzf application.tar.gz --exclude='./.env' -C /www/wwwroot/anikoto-app
cd /www/wwwroot/anikoto-app
node scripts/set-catalog-provider.mjs anikoto classic
```

Then restart **anijs**. Do not restore the database for an ordinary appearance rollback: restoring that snapshot would discard accounts/comments created after the backup. Restore `environment.env` or `anikoto.db` only as a separate recovery action when specifically needed.

## Source behavior

Miruro supplies AniList metadata, search, spotlight, popular, upcoming, related titles and recommendations. Existing AniKoto slug URLs are supported. The latest-episode feed continues using the episode-update feed, since Miruro's `/recent` means currently airing series sorted by start date, not newly uploaded playable episodes.

Miruro playback is attempted through its provider API. If that source is unavailable, the adapter searches AniKoto and checks the **MAL ID in episode data** before using it as a fallback. A similar title alone is insufficient. If neither source lists an episode, the UI reports it unavailable rather than generating fictitious playable episodes. External providers can still experience outages. The Aniyear player, login, Google OAuth, comments, subtitle translation, language switch, logo/favicon and dynamic sitemap are retained.

Imported upstream code and MIT license are under `services/miruro-api`. Only the private wrapper is launched; the upstream documentation page, public proxy route and rate limiter are not exposed publicly. The application adapter uses an explicit endpoint allowlist, bounded caches, request deduplication and HTTPS media checks.
