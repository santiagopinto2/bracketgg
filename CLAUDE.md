# BracketGG

Angular viewer for start.gg brackets, live at https://bracket.santiagopinto.dev.

## start.gg API

- Before saying the API has or lacks something, look it up in `docs/startgg-schema.graphql`: the whole public schema, saved from introspection. Refresh it with `STARTGG_TOKEN=... node scripts/startgg-schema.mjs` and commit the diff.
- Things start.gg's website shows that the public API doesn't have: ranking series logos (`RankingSeries` isn't in the schema; `PlayerRank.images` is a different, often empty, image) and the event description.
- Query complexity counts the objects actually returned, about 1000 per request at most. A refusal message includes "(actual: N)".
- Measured costs: a slimmed set is about 10 objects (with the phase id and games, no characters), games where none were reported cost 1 per set, full best of 5 character data is about 50 per set.
- Phase-level `sets` returns each pool's sets in the same order as asking per pool.
- All queries go through the site's own cache, `POST /api/gql` (`server/gql-cache.js`), via `src/app/services/startgg.service.ts`.

## Building and testing

CI (`.github/workflows/ci.yml`, `e2e/compare.sh`) builds and tests every PR and push to main. `e2e/api-calls.mjs` runs the app against a fake start.gg.
