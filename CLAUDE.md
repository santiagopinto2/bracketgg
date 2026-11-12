# BracketGG

Angular viewer for start.gg brackets, live at https://bracket.santiagopinto.dev.

## start.gg API

- Before saying the API has or lacks something, look it up in `docs/startgg-schema.graphql`: the whole public schema, saved from introspection. Refresh it with `STARTGG_TOKEN=... node scripts/startgg-schema.mjs` and commit the diff.
- Things start.gg's website shows that the public API doesn't have: ranking series logos (`RankingSeries` isn't in the schema; `PlayerRank.images` is a different, often empty, image) and the event description.
- Query complexity counts the objects actually returned, about 1000 per request at most. A refusal message includes "(actual: N)".
- Measured costs: a slimmed set is about 10 objects (with the phase id and games, no characters), games where none were reported cost 1 per set, full best of 5 character data is about 50 per set.
- Phase-level `sets` returns each pool's sets in the same order as asking per pool.
- All queries go through the site's own cache, `POST /api/gql` (`server/gql-cache.js`), via `src/app/services/startgg.service.ts`.
- Query texts live in `src/app/services/startgg-queries.ts`, with GraphQL variables for slugs, ids and pages. The server runs only those exact texts (`server/gql-allowlist.js` loads the same file), so a new or changed query goes there and nowhere else.

## Server (`proxy-server.js`, `server/`)

- Logging in is optional. Visitors who aren't logged in are served with the site's own token (`STARTGG_SITE_TOKEN`), held to 70 requests a minute by `server/site-gate.js`; past that `/api/gql` answers 503 `SITE_BUSY` with Retry-After.
- Logged-in visitors' start.gg tokens stay on the server (`server/sessions.js`, saved to `SESSIONS_FILE`); the browser holds only the HttpOnly `bgg_session` cookie. `server/auth.js` refreshes tokens and ends a session only when start.gg refuses its refresh token.
- Environment: `STARTGG_CLIENT_ID`, `STARTGG_CLIENT_SECRET`, `STARTGG_REDIRECT_URI`, `STARTGG_SITE_TOKEN`, `SESSIONS_FILE` (on a writable volume); the full list is at the top of `proxy-server.js`. Needs Node 22.18+.

## Building and testing

CI (`.github/workflows/ci.yml`, `e2e/compare.sh`) builds and tests every PR and push to main. `e2e/api-calls.mjs` runs the app against a fake start.gg. `e2e/gql-cache.mjs` tests the cache, allowlist and site gate; `e2e/auth.mjs` runs the real server against a fake start.gg for login, sessions and security headers.
